import * as vscode from 'vscode';
import {
  chat,
  generateFim,
  getConfig,
  stripCodeFences,
  FimNotSupportedError,
  SYSTEM_PROMPT,
} from '../utils/ollama';

const PREFIX_LINES = 60;
const SUFFIX_LINES = 20;

function sleep(ms: number, token: vscode.CancellationToken): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      sub.dispose();
      resolve();
    }, ms);
    const sub = token.onCancellationRequested(() => {
      clearTimeout(timer);
      sub.dispose();
      resolve();
    });
  });
}

export class LocalAIInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
  /** Modelos que já responderam que não suportam FIM (usa chat como plano B) */
  private fimUnsupported = new Set<string>();

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    const settings = vscode.workspace.getConfiguration('local-ai');
    if (!settings.get<boolean>('enableInlineCompletion', true)) {
      return undefined;
    }

    // Debounce de verdade: espera o usuário parar de digitar.
    // A cada nova tecla o VS Code cancela o token anterior, então só o último pedido segue.
    const delay = settings.get<number>('inlineCompletionDelay', 800);
    await sleep(delay, token);
    if (token.isCancellationRequested) return undefined;

    const startLine = Math.max(0, position.line - PREFIX_LINES);
    const prefix = document.getText(new vscode.Range(startLine, 0, position.line, position.character));

    const endLine = Math.min(document.lineCount - 1, position.line + SUFFIX_LINES);
    const suffix = document.getText(
      new vscode.Range(position, document.lineAt(endLine).range.end)
    );

    if (prefix.trim().length < 10) {
      return undefined; // muito pouco contexto
    }

    // Cancela a requisição HTTP no Ollama se o usuário voltar a digitar
    const abort = new AbortController();
    const sub = token.onCancellationRequested(() => abort.abort());

    try {
      const { model } = getConfig();
      let completion: string;

      if (!this.fimUnsupported.has(model)) {
        try {
          completion = await generateFim(prefix, suffix, {
            maxTokens: 128,
            temperature: 0.1,
            signal: abort.signal,
          });
        } catch (err) {
          if (err instanceof FimNotSupportedError) {
            this.fimUnsupported.add(model);
            completion = await this.completeViaChat(document.languageId, prefix, suffix, abort.signal);
          } else {
            throw err;
          }
        }
      } else {
        completion = await this.completeViaChat(document.languageId, prefix, suffix, abort.signal);
      }

      if (token.isCancellationRequested) return undefined;

      completion = completion.replace(/\s+$/, '');
      if (!completion.trim()) return undefined;

      return [new vscode.InlineCompletionItem(completion, new vscode.Range(position, position))];
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        // Silencioso no autocomplete para não atrapalhar
        console.error('[Local AI] Inline completion error:', err);
      }
      return undefined;
    } finally {
      sub.dispose();
    }
  }

  /** Plano B para modelos sem suporte a FIM */
  private async completeViaChat(
    language: string,
    prefix: string,
    suffix: string,
    signal: AbortSignal
  ): Promise<string> {
    const prompt = `Complete o código a seguir. Retorne APENAS o código que deve ser inserido na posição do cursor, sem explicações, sem markdown, sem comentários extras.

Linguagem: ${language}

Código antes do cursor:
\`\`\`${language}
${prefix}
\`\`\`

Código depois do cursor:
\`\`\`${language}
${suffix}
\`\`\`

Complete de forma natural e curta (máximo 5-15 linhas).`;

    const response = await chat(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      { maxTokens: 256, temperature: 0.1, signal }
    );

    let completion = stripCodeFences(response);

    // Modelos de chat às vezes repetem a linha atual; remove a parte já digitada
    const currentLine = prefix.split('\n').pop() ?? '';
    if (currentLine.trim() && completion.trimStart().startsWith(currentLine.trim())) {
      completion = completion.trimStart().slice(currentLine.trim().length);
    }
    return completion;
  }
}
