import * as vscode from 'vscode';
import { chat, getConfig } from './ollama';

export interface CodeIssue {
  line: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
  suggestion: string;
}

const DIAGNOSTIC_COLLECTION = vscode.languages.createDiagnosticCollection('local-ai');

function getCharBudget(): number {
  const { numCtx } = getConfig();
  return Math.max(2000, Math.floor(numCtx * 0.3 * 3.5)); // 30% do contexto para auto-review
}

export async function analyzeCodeOnSave(document: vscode.TextDocument): Promise<void> {
  if (!shouldAnalyze(document)) return;

  const code = document.getText();
  const budget = getCharBudget();
  const issues = await findCodeIssues(code, document.languageId, budget);

  if (issues.length === 0) {
    DIAGNOSTIC_COLLECTION.set(document.uri, []);
    return;
  }

  const diagnostics = issues.map((issue) =>
    new vscode.Diagnostic(
      new vscode.Range(issue.line, 0, issue.line, 999),
      `[Local AI] ${issue.message}`,
      issue.severity === 'error' ? vscode.DiagnosticSeverity.Error :
      issue.severity === 'warning' ? vscode.DiagnosticSeverity.Warning :
      vscode.DiagnosticSeverity.Information
    )
  );

  DIAGNOSTIC_COLLECTION.set(document.uri, diagnostics);
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

async function findCodeIssues(code: string, language: string, budget: number): Promise<CodeIssue[]> {
  try {
    const slice = code.slice(0, budget);
    
    const prompt = `Analise este código ${language} brevemente.
    Retorne APENAS issues críticos em JSON: [{"line": N, "severity": "error|warning", "message": "...", "suggestion": "..."}]

Código:
\`\`\`${language}
${slice}
\`\`\``;

    const response = await chat(
      [{ role: 'system', content: 'Retorne JSON puro, sem markdown' },
       { role: 'user', content: prompt }],
      { maxTokens: 256, temperature: 0.1 }
    );

    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const issues = JSON.parse(jsonMatch[0]) as CodeIssue[];
    return issues.slice(0, 5); // Máx 5 issues
  } catch (error) {
    return [];
  }
}

export function disposeDiagnostics(): void {
  DIAGNOSTIC_COLLECTION.dispose();
}
