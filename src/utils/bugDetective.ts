import * as vscode from 'vscode';
import { chat } from './ollama';

export interface BugPattern {
  pattern: string;
  severity: 'critical' | 'warning' | 'info';
  description: string;
  examples: string[];
  suggestedFix: string;
  detectedCount: number;
}

export interface BugAnalysis {
  patterns: BugPattern[];
  riskScore: number; // 0-100
  timestamp: Date;
}

const COMMON_PATTERNS = [
  {
    pattern: 'null_pointer_dereference',
    regex: /\w+\.\w+(?!\s*\?)/g,
    severity: 'critical' as const,
    description: 'Possível null pointer dereference sem verificação',
    suggestedFix: 'Verifique se o objeto é null antes de acessar propriedades',
  },
  {
    pattern: 'hardcoded_secrets',
    regex: /(password|secret|apikey|token)\s*=\s*["'][^"']*["']/gi,
    severity: 'critical' as const,
    description: 'Credenciais hardcoded no código',
    suggestedFix: 'Mova para variáveis de ambiente (.env)',
  },
  {
    pattern: 'missing_error_handling',
    regex: /await\s+\w+\(?[^)]*\)(?!\s*(\.catch|\s*catch|\s*\?))/g,
    severity: 'warning' as const,
    description: 'Await sem error handling',
    suggestedFix: 'Adicione try/catch ou .catch() para tratar erros',
  },
  {
    pattern: 'sql_injection',
    regex: /query\s*\([^)]*\$\{[^}]*\}[^)]*\)/gi,
    severity: 'critical' as const,
    description: 'Possível SQL injection',
    suggestedFix: 'Use parameterized queries (prepared statements)',
  },
  {
    pattern: 'infinite_loop',
    regex: /while\s*\(\s*true\s*\)|for\s*\(\s*;\s*;\s*\)/g,
    severity: 'warning' as const,
    description: 'Possível infinite loop',
    suggestedFix: 'Verifique a condição de parada do loop',
  },
  {
    pattern: 'race_condition',
    regex: /let\s+\w+\s*=\s*\w+\s*;\s*async\s*function/g,
    severity: 'warning' as const,
    description: 'Variável compartilhada em código async',
    suggestedFix: 'Use locks ou variáveis locais para evitar race conditions',
  },
];

export class BugDetective {
  constructor() {}

  async analyzeCode(code: string, language: string): Promise<BugAnalysis> {
    const patterns: BugPattern[] = [];
    let riskScore = 0;

    // Check common patterns
    for (const pattern of COMMON_PATTERNS) {
      const matches = [...code.matchAll(new RegExp(pattern.regex))];
      if (matches.length > 0) {
        patterns.push({
          pattern: pattern.pattern,
          severity: pattern.severity,
          description: pattern.description,
          examples: matches.map((m) => m[0]).slice(0, 3),
          suggestedFix: pattern.suggestedFix,
          detectedCount: matches.length,
        });

        if (pattern.severity === 'critical') riskScore += 20;
        else if (pattern.severity === 'warning') riskScore += 10;
      }
    }

    // AI-powered analysis for complex patterns
    if (code.length > 200) {
      const aiPatterns = await this.analyzeWithAI(code, language);
      patterns.push(...aiPatterns);
      riskScore = Math.min(100, riskScore + aiPatterns.length * 5);
    }

    return {
      patterns: patterns.sort((a, b) => {
        const severityOrder = { critical: 0, warning: 1, info: 2 };
        return severityOrder[a.severity] - severityOrder[b.severity];
      }),
      riskScore: Math.min(100, riskScore),
      timestamp: new Date(),
    };
  }

  private async analyzeWithAI(code: string, language: string): Promise<BugPattern[]> {
    try {
      const prompt = `Analise este ${language} código e identifique possíveis bugs ou problemas de segurança:

${code.slice(0, 1000)}

Retorne JSON array: [{"pattern": "name", "severity": "critical|warning|info", "description": "...", "fix": "..."}]

Limite a 3 padrões.`;

      const response = await chat(
        [{ role: 'user', content: prompt }],
        { maxTokens: 300, temperature: 0.2 }
      );

      try {
        const match = response.match(/\[[\s\S]*\]/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          return parsed.map((p: any) => ({
            pattern: p.pattern,
            severity: p.severity || 'info',
            description: p.description,
            examples: [],
            suggestedFix: p.fix,
            detectedCount: 1,
          }));
        }
      } catch {}
    } catch {}

    return [];
  }

  async showAnalysisReport(analysis: BugAnalysis): Promise<void> {
    if (analysis.patterns.length === 0) {
      vscode.window.showInformationMessage('✅ Nenhum bug detectado');
      return;
    }

    const riskLevel =
      analysis.riskScore >= 80
        ? '🔴 CRÍTICO'
        : analysis.riskScore >= 50
          ? '🟠 ALTO'
          : analysis.riskScore >= 30
            ? '🟡 MÉDIO'
            : '🟢 BAIXO';

    let report = `\n🐛 Bug Detective Analysis\n`;
    report += `Risk Level: ${riskLevel} (${analysis.riskScore}/100)\n\n`;

    for (const pattern of analysis.patterns) {
      const icon =
        pattern.severity === 'critical' ? '🔴' : pattern.severity === 'warning' ? '⚠️' : 'ℹ️';
      report += `${icon} ${pattern.pattern}\n`;
      report += `   ${pattern.description}\n`;
      if (pattern.examples.length > 0) {
        report += `   Example: ${pattern.examples[0]}\n`;
      }
      report += `   Fix: ${pattern.suggestedFix}\n\n`;
    }

    const panel = vscode.window.createWebviewPanel(
      'bugDetective',
      'Bug Detective Report',
      vscode.ViewColumn.Two,
      {}
    );

    panel.webview.html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: monospace; padding: 20px; }
          .critical { color: #ff4444; }
          .warning { color: #ffaa00; }
          .info { color: #4488ff; }
        </style>
      </head>
      <body>
        <h2>Bug Detective Analysis</h2>
        <p>Risk: ${riskLevel}</p>
        <pre>${report}</pre>
      </body>
      </html>
    `;
  }

  async detectPatterns(code: string): Promise<string[]> {
    const patterns: string[] = [];

    // Quick pattern checks
    if (code.match(/\w+\.\w+(?!\s*\?)/)) patterns.push('Potential null references');
    if (code.match(/(password|secret|apikey|token)\s*=\s*["'][^"']*["']/i))
      patterns.push('Hardcoded secrets');
    if (code.match(/await\s+\w+\(?[^)]*\)(?!\s*(\.catch|\s*catch))/))
      patterns.push('Missing error handling');
    if (code.match(/query\s*\([^)]*\$\{[^}]*\}/i)) patterns.push('SQL injection risk');
    if (code.match(/while\s*\(\s*true\s*\)/)) patterns.push('Infinite loop');

    return [...new Set(patterns)];
  }
}

export async function showBugDetectiveUI(detective: BugDetective): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('No active editor');
    return;
  }

  const code = editor.document.getText();
  const language = editor.document.languageId;

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: '🐛 Analyzing for bugs...' },
    async () => {
      const analysis = await detective.analyzeCode(code, language);
      await detective.showAnalysisReport(analysis);
    }
  );
}
