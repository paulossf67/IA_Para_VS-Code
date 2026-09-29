import * as vscode from 'vscode';
import { chat, getConfig } from './ollama';

export interface CodeIssue {
  line: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
  suggestion: string;
}

const DIAGNOSTIC_COLLECTION = vscode.languages.createDiagnosticCollection('local-ai');
const REVIEW_OUTPUT = vscode.window.createOutputChannel('Local AI Review');
const latestAnalysisByUri = new Map<string, number>();
let nextAnalysisId = 0;

export interface CodeReviewChunk {
  text: string;
  startLine: number;
  endLine: number;
}

export class CodeReviewActionProvider implements vscode.CodeActionProvider {
  provideCodeActions(
    _document: vscode.TextDocument,
    _range: vscode.Range,
    context: vscode.CodeActionContext
  ): vscode.CodeAction[] {
    return context.diagnostics
      .filter((diagnostic) => diagnostic.source === 'Local AI Review')
      .map((diagnostic) => {
        const action = new vscode.CodeAction('Corrigir com Local AI', vscode.CodeActionKind.QuickFix);
        action.diagnostics = [diagnostic];
        action.command = {
          title: action.title,
          command: 'local-ai.fixDiagnostic',
          arguments: [diagnostic.range, diagnostic.message, typeof diagnostic.code === 'string' ? diagnostic.code : ''],
        };
        return action;
      });
  }
}

export class DocumentReviewScheduler {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  schedule(uri: string, delay: number, callback: () => void): void {
    const existingTimer = this.timers.get(uri);
    if (existingTimer) clearTimeout(existingTimer);

    const timer = setTimeout(() => {
      if (this.timers.get(uri) !== timer) return;
      this.timers.delete(uri);
      callback();
    }, delay);
    this.timers.set(uri, timer);
  }

  dispose(): void {
    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers.clear();
  }
}

function getCharBudget(): number {
  const { numCtx } = getConfig();
  return Math.max(2000, Math.floor(numCtx * 0.3 * 3.5)); // 30% do contexto para auto-review
}

export async function analyzeCodeOnSave(document: vscode.TextDocument): Promise<void> {
  if (!shouldAnalyze(document)) return;

  const uri = document.uri.toString();
  const version = document.version;
  const analysisId = ++nextAnalysisId;
  latestAnalysisByUri.set(uri, analysisId);

  try {
    const code = document.getText();
    const issues = code.trim()
      ? await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Local AI: analisando código',
          cancellable: false,
        },
        (progress) => findCodeIssues(code, document.languageId, getCharBudget(), progress)
      )
      : [];

    if (document.version !== version || latestAnalysisByUri.get(uri) !== analysisId) return;

    const diagnostics = issues.map((issue) => {
      const diagnostic = new vscode.Diagnostic(
        new vscode.Range(issue.line - 1, 0, issue.line - 1, document.lineAt(issue.line - 1).text.length),
        `[Local AI] ${issue.message}\nSugestão: ${issue.suggestion}`,
        issue.severity === 'error' ? vscode.DiagnosticSeverity.Error :
        issue.severity === 'warning' ? vscode.DiagnosticSeverity.Warning :
        vscode.DiagnosticSeverity.Information
      );
      diagnostic.source = 'Local AI Review';
      diagnostic.code = issue.suggestion;
      return diagnostic;
    });

    DIAGNOSTIC_COLLECTION.set(document.uri, diagnostics);
    if (code.trim() && issues.length === 0) {
      void vscode.window.showInformationMessage('Local AI: nenhum problema encontrado; o código parece correto.');
    }
  } catch (error) {
    if (latestAnalysisByUri.get(uri) === analysisId) {
      const message = error instanceof Error ? error.message : String(error);
      REVIEW_OUTPUT.appendLine(`Falha ao analisar ${document.uri.fsPath}: ${message}`);
      REVIEW_OUTPUT.show(true);
    }
  } finally {
    if (latestAnalysisByUri.get(uri) === analysisId) latestAnalysisByUri.delete(uri);
  }
}

function shouldAnalyze(document: vscode.TextDocument): boolean {
  // Não analisa certos arquivos
  const skipPatterns = ['node_modules', '.git', 'dist', 'build', '.env'];

  for (const pattern of skipPatterns) {
    if (document.uri.fsPath.includes(pattern)) return false;
  }

  // Analisa apenas código
  const codeLanguages = ['javascript', 'typescript', 'python', 'java', 'csharp', 'go', 'rust', 'cpp', 'c'];
  return codeLanguages.includes(document.languageId);
}

export function createCodeChunks(code: string, budget: number): CodeReviewChunk[] {
  const lines = code.split(/\r?\n/);
  const chunks: CodeReviewChunk[] = [];
  let currentLines: string[] = [];
  let currentLength = 0;
  let startLine = 1;
  let endLine = 1;
  const fragmentBudget = Math.max(1, budget - 32);

  const flush = () => {
    if (currentLines.length === 0) return;
    chunks.push({ text: currentLines.join('\n'), startLine, endLine });
    currentLines = [];
    currentLength = 0;
  };

  lines.forEach((line, lineIndex) => {
    const sourceLine = lineIndex + 1;
    const fragments: string[] = [];
    for (let offset = 0; offset < line.length; offset += fragmentBudget) {
      fragments.push(line.slice(offset, offset + fragmentBudget));
    }
    if (fragments.length === 0) fragments.push('');

    fragments.forEach((fragment, fragmentIndex) => {
      const label = fragmentIndex === 0 ? `${sourceLine}` : `${sourceLine} (continuação)`;
      const numberedLine = `${label}: ${fragment}`;
      const addedLength = numberedLine.length + (currentLines.length > 0 ? 1 : 0);
      if (currentLength + addedLength > budget) flush();
      if (currentLines.length === 0) startLine = sourceLine;
      currentLines.push(numberedLine);
      currentLength += numberedLine.length + (currentLines.length > 1 ? 1 : 0);
      endLine = sourceLine;
    });
  });

  flush();
  return chunks;
}

export function parseCodeIssues(
  response: string,
  chunk: CodeReviewChunk,
  totalLines: number
): CodeIssue[] {
  const json = response.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) throw new Error('A resposta da revisão não é uma lista JSON.');

  return parsed.map((value: unknown) => {
    if (!value || typeof value !== 'object') throw new Error('Issue inválido na resposta da revisão.');
    const issue = value as Record<string, unknown>;
    if (!Number.isInteger(issue.line) || (issue.line as number) < chunk.startLine ||
        (issue.line as number) > chunk.endLine || (issue.line as number) > totalLines) {
      throw new Error('A resposta da revisão contém uma linha fora do trecho analisado.');
    }
    if (issue.severity !== 'error' && issue.severity !== 'warning' && issue.severity !== 'info') {
      throw new Error('A resposta da revisão contém uma severidade inválida.');
    }
    if (typeof issue.message !== 'string' || !issue.message.trim() ||
        typeof issue.suggestion !== 'string' || !issue.suggestion.trim()) {
      throw new Error('A resposta da revisão contém mensagem ou sugestão inválida.');
    }
    return {
      line: issue.line as number,
      severity: issue.severity,
      message: issue.message.trim(),
      suggestion: issue.suggestion.trim(),
    };
  });
}

async function findCodeIssues(
  code: string,
  language: string,
  budget: number,
  progress?: vscode.Progress<{ message?: string; increment?: number }>
): Promise<CodeIssue[]> {
  const lines = code.split(/\r?\n/);
  const chunks = createCodeChunks(code, budget);
  const issues: CodeIssue[] = [];

  for (const [chunkIndex, chunk] of chunks.entries()) {
    progress?.report({
      message: `Trecho ${chunkIndex + 1}/${chunks.length}`,
      increment: 100 / chunks.length,
    });
    const prompt = `Analise este trecho de código ${language}. As linhas estão numeradas com a linha absoluta do arquivo.
Retorne APENAS um array JSON com issues críticos: [{"line": N, "severity": "error|warning|info", "message": "...", "suggestion": "..."}].
Use somente linhas entre ${chunk.startLine} e ${chunk.endLine}. Se não encontrar issues, retorne [].

Código:
\`\`\`${language}
${chunk.text}
\`\`\``;

    const response = await chat(
      [
        { role: 'system', content: 'Retorne JSON puro, sem markdown ou explicações.' },
        { role: 'user', content: prompt },
      ],
      { maxTokens: 256, temperature: 0.1 }
    );
    issues.push(...parseCodeIssues(response, chunk, lines.length));
  }

  const severityOrder = { error: 0, warning: 1, info: 2 };
  return issues
    .sort((first, second) => severityOrder[first.severity] - severityOrder[second.severity] || first.line - second.line)
    .slice(0, 5);
}

export function disposeDiagnostics(): void {
  latestAnalysisByUri.clear();
  DIAGNOSTIC_COLLECTION.dispose();
  REVIEW_OUTPUT.dispose();
}
