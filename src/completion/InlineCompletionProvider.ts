import * as vscode from 'vscode';
import {
  chat,
  chatStream,
  generateFim,
  generateFimStream,
  getConfig,
  stripCodeFences,
  FimNotSupportedError,
  SYSTEM_PROMPT,
} from '../utils/ollama';

const PREFIX_LINES = 60;
const SUFFIX_LINES = 20;
const MAX_COMPLETION_LINES = 15;
const MAX_COMPLETION_CHARS = 500;

/** Espera `ms`, ou resolve antes se o token for cancelado. Exportada para teste. */
export function sleep(ms: number, token: vscode.CancellationToken): Promise<void> {
  return new Promise((resolve) => {
    let sub: vscode.Disposable | undefined;
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      sub?.dispose();
      resolve();
    };

    const timer = setTimeout(finish, ms);

    sub = token.onCancellationRequested(() => {
      clearTimeout(timer);
      finish();
    });

    if (token.isCancellationRequested) {
      clearTimeout(timer);
      finish();
    }
  });
}

/** Acumula chunks de streaming e retorna quando completa ou cancelado */
async function collectStream(
  streamPromise: Promise<string>,
  token: vscode.CancellationToken,
  onProgress?: (partial: string) => void
): Promise<string | undefined> {
  try {
    const result = await streamPromise;
    if (token.isCancellationRequested) return undefined;
    return result;
  } catch (err: any) {
    if (err?.name === 'AbortError' || token.isCancellationRequested) return undefined;
    throw err;
  }
}

export class LocalAIInlineCompletionProvider implements vscode.InlineCompletionItemProvider {
  /** Modelos que já responderam que não suportam FIM (usa chat como plano B) */
  private fimUnsupported = new Set<string>();
  private fimFallbackNotified = new Set<string>();

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

    // Debounce: espera o usuário parar de digitar
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
    const sub = token.onCancellationRequested(() => {
      if (token.isCancellationRequested) {
        abort.abort();
      }
    });

    try {
      const { model } = getConfig();
      let completion: string | undefined;

      if (!this.fimUnsupported.has(model)) {
        try {
          // STREAMING FIM: chunks chegam conforme o modelo gera
          completion = await generateFim(prefix, suffix, {
            maxTokens: 128,
            temperature: 0.1,
            signal: abort.signal,
          });

          if (token.isCancellationRequested) return undefined;

          if (completion === undefined) return undefined; // cancelado

        } catch (err) {
          if (err instanceof FimNotSupportedError) {
            this.fimUnsupported.add(model);
            if (!this.fimFallbackNotified.has(model)) {
              this.fimFallbackNotified.add(model);
              void vscode.window.showInformationMessage(
                `Local AI: modelo "${model}" não suporta FIM (Fill-in-the-Middle). Usando chat como alternativa — sugestões podem ser mais lentas.`
              );
            }
            completion = await this.completeViaChatStream(document.languageId, prefix, suffix, abort.signal, token);
          } else {
            throw err;
          }
        }
      } else {
        // Plano B: chat com streaming
        completion = await this.completeViaChatStream(document.languageId, prefix, suffix, abort.signal, token);
      }

      if (completion === undefined) return undefined; // cancelado
      if (token.isCancellationRequested) return undefined;

      // Pós-processamento: limpa e limita
      completion = this.postProcessCompletion(completion, prefix);
      if (!completion.trim()) return undefined;

      return [new vscode.InlineCompletionItem(completion, new vscode.Range(position, position))];
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        console.error('[Local AI] Inline completion error:', err);
      }
      return undefined;
    } finally {
      sub.dispose();
    }
  }

  /** Plano B: Chat com streaming para modelos sem FIM */
  private async completeViaChatStream(
    language: string,
    prefix: string,
    suffix: string,
    signal: AbortSignal,
    token: vscode.CancellationToken
  ): Promise<string | undefined> {
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

Complete de forma natural e curta (máximo ${MAX_COMPLETION_LINES} linhas, ~${MAX_COMPLETION_CHARS} chars).`;

    try {
      const completion = await chat(
        [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        {
          maxTokens: MAX_COMPLETION_CHARS,
          temperature: 0.1,
          signal,
        }
      );

      if (token.isCancellationRequested) return undefined;
      return completion;
    } catch {
      return undefined;
    }
  }

  /** Pós-processamento: limpa, limita linhas/chars, remove duplicatas */
  private postProcessCompletion(completion: string, prefix: string): string {
    // Remove cercas de markdown se houver
    completion = stripCodeFences(completion);

    // Remove espaços em branco no final
    completion = completion.replace(/\s+$/, '');

    // Limita linhas
    const lines = completion.split('\n');
    if (lines.length > MAX_COMPLETION_LINES) {
      completion = lines.slice(0, MAX_COMPLETION_LINES).join('\n');
    }

    // Limita caracteres
    if (completion.length > MAX_COMPLETION_CHARS) {
      completion = completion.slice(0, MAX_COMPLETION_CHARS);
    }

    // Modelos de chat às vezes repetem a linha atual; remove a parte já digitada
    const currentLine = prefix.split('\n').pop() ?? '';
    if (currentLine.trim() && completion.trimStart().startsWith(currentLine.trim())) {
      completion = completion.trimStart().slice(currentLine.trim().length);
    }

    return completion;
  }
}