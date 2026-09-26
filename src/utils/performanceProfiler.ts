import * as vscode from 'vscode';
import { chat } from './ollama';

export interface PerformanceIssue {
  location: string;
  line: number;
  severity: 'critical' | 'warning' | 'info';
  issue: string;
  complexity: string; // 'O(n)', 'O(n²)', etc
  suggestion: string;
  estimatedFix: string;
}

export class PerformanceProfiler {
  async analyzeCode(code: string, language: string): Promise<PerformanceIssue[]> {
    const issues: PerformanceIssue[] = [];

    // Pattern detection
    const patterns = [
      {
        regex: /for\s*\([^)]*\)\s*\{[^}]*for\s*\(/,
        issue: 'Nested loops detected (O(n²) complexity)',
        suggestion: 'Consider using Map/Set or sorting instead',
        complexity: 'O(n²)',
      },
      {
        regex: /\beval\s*\(/gi,
        issue: 'eval() is dangerous and slow',
        suggestion: 'Use Function() or alternative',
        complexity: 'Very Slow',
      },
      {
        regex: /for\s*\([^)]*in\s+Object/gi,
        issue: 'Iterating over object with for-in',
        suggestion: 'Use Object.keys() or Object.entries()',
        complexity: 'O(n)',
      },
    ];

    for (const pattern of patterns) {
      const matches = code.match(pattern.regex);
      if (matches) {
        const line = code.substring(0, code.indexOf(matches[0])).split('\n').length;
        issues.push({
          location: `Line ${line}`,
          line,
          severity: 'warning',
          issue: pattern.issue,
          suggestion: pattern.suggestion,
          complexity: pattern.complexity,
          estimatedFix: `Refactor to reduce complexity from ${pattern.complexity}`,
        });
      }
    }

    // AI-powered analysis
    if (issues.length < 5) {
      const aiIssues = await this.analyzeWithAI(code, language);
      issues.push(...aiIssues);
    }

    return issues.sort((a, b) => a.line - b.line);
  }

  private async analyzeWithAI(code: string, language: string): Promise<PerformanceIssue[]> {
    try {
      const prompt = `Analyze ${language} code for performance issues:
${code.slice(0, 800)}

Return JSON array: [{"line": 1, "issue": "...", "complexity": "O(...)", "suggestion": "..."}]`;

      const response = await chat([{ role: 'user', content: prompt }], {
        maxTokens: 300,
        temperature: 0.2,
      });

      try {
        const match = response.match(/\[[\s\S]*\]/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          return parsed.map((p: any): PerformanceIssue => ({
            location: `Line ${p.line}`,
            line: p.line,
            severity: 'warning',
            issue: p.issue,
            complexity: p.complexity,
            suggestion: p.suggestion,
            estimatedFix: `Optimize to improve performance`,
          }));
        }
      } catch {}
    } catch {}

    return [];
  }

  async showReport(issues: PerformanceIssue[]): Promise<void> {
    if (issues.length === 0) {
      vscode.window.showInformationMessage('✅ No performance issues detected');
      return;
    }

    const criticalCount = issues.filter((i) => i.severity === 'critical').length;
    const warningCount = issues.filter((i) => i.severity === 'warning').length;

    let report = `⚡ Performance Profile\n\n`;
    report += `🔴 Critical: ${criticalCount}\n`;
    report += `⚠️  Warnings: ${warningCount}\n\n`;

    for (const issue of issues) {
      report += `${issue.location}: ${issue.issue} [${issue.complexity}]\n`;
      report += `   💡 ${issue.suggestion}\n\n`;
    }

    const panel = vscode.window.createWebviewPanel('perfProfiler', 'Performance Profile', vscode.ViewColumn.Two);
    panel.webview.html = `
      <html><body style="font-family: monospace; white-space: pre;">
        ${report}
      </body></html>
    `;
  }
}

export async function showPerformanceProfilerUI(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('No active editor');
    return;
  }

  const profiler = new PerformanceProfiler();
  const code = editor.document.getText();
  const language = editor.document.languageId;

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: '⚡ Analyzing performance...' },
    async () => {
      const issues = await profiler.analyzeCode(code, language);
      await profiler.showReport(issues);
    }
  );
}
