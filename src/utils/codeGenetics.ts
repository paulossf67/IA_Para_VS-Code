import * as vscode from 'vscode';
import { chat } from './ollama';

export interface EvolutionEvent {
  date: string;
  commit: string;
  author: string;
  message: string;
  changes: {
    added: number;
    removed: number;
  };
  semanticSummary: string;
  category: 'feature' | 'refactor' | 'fix' | 'test' | 'docs' | 'style' | 'other';
}

export interface FunctionEvolution {
  name: string;
  filePath: string;
  currentCode: string;
  events: EvolutionEvent[];
  summary: string;
}

export class CodeGenetics {
  constructor(private context: vscode.ExtensionContext) {}

  async analyzeFileEvolution(filePath: string, maxCommits = 20): Promise<EvolutionEvent[]> {
    const gitAPI = await this.getGitAPI();
    if (!gitAPI) return [];

    try {
      const repo = gitAPI.repositories[0];
      const log = await repo.log({ path: filePath, maxEntries: maxCommits });

      const events: EvolutionEvent[] = [];

      for (const entry of log) {
        const diff = await this.getCommitDiff(repo, entry.hash, filePath);
        const semanticSummary = await this.analyzeSemanticChange(diff, filePath);

        const category = this.categorizeCommit(entry.message, semanticSummary);

        events.push({
          date: entry.parents[0] ? new Date(entry.parents[0]).toISOString() : new Date().toISOString(),
          commit: entry.hash.slice(0, 8),
          author: entry.author?.name || 'Unknown',
          message: entry.message.split('\n')[0],
          changes: { added: 0, removed: 0 }, // Would need more detailed diff
          semanticSummary,
          category,
        });
      }

      return events;
    } catch (err) {
      console.error('[CodeGenetics] analyzeFileEvolution error:', err);
      return [];
    }
  }

  async analyzeFunctionEvolution(
    filePath: string,
    functionName: string,
    maxCommits = 15
  ): Promise<FunctionEvolution | null> {
    const events = await this.analyzeFileEvolution(filePath, maxCommits);

    if (events.length === 0) return null;

    // Get current function code
    const currentCode = await this.extractFunction(filePath, functionName);

    // Generate overall summary
    const summary = await this.generateEvolutionSummary(functionName, events);

    return {
      name: functionName,
      filePath,
      currentCode: currentCode || '',
      events,
      summary,
    };
  }

  private async getGitAPI(): Promise<any> {
    const gitExt = vscode.extensions.getExtension('vscode.git');
    if (!gitExt) return null;
    if (!gitExt.isActive) await gitExt.activate();
    return gitExt.exports.getAPI(1);
  }

  private async getCommitDiff(repo: any, commitHash: string, filePath: string): Promise<string> {
    try {
      // Use git show to get diff for specific file in commit
      const diff = await repo.diffWithHEAD(filePath);
      return diff;
    } catch {
      return '';
    }
  }

  private async analyzeSemanticChange(diff: string, filePath: string): Promise<string> {
    if (!diff || diff.length < 50) return 'Minor change';

    try {
      const prompt = `Analyze this git diff for ${filePath} and provide a ONE-LINE semantic summary of what changed:

${diff.slice(0, 1500)}

Focus on: WHAT functionality changed, not syntax. Examples:
- "Added null check for user input validation"
- "Refactored authentication to use JWT tokens"
- "Fixed race condition in cache invalidation"
- "Improved performance by caching API responses"

Return ONLY the summary, no markdown.`;

      const response = await chat(
        [{ role: 'user', content: prompt }],
        { maxTokens: 80, temperature: 0.1 }
      );

      return response.trim().slice(0, 200);
    } catch {
      return 'Change detected (AI analysis failed)';
    }
  }

  private categorizeCommit(message: string, summary: string): EvolutionEvent['category'] {
    const text = (message + ' ' + summary).toLowerCase();

    if (/\b(fix|bug|error|issue|crash)\b/.test(text)) return 'fix';
    if (/\b(refactor|cleanup|restructure|reorganize)\b/.test(text)) return 'refactor';
    if (/\b(test|spec|coverage)\b/.test(text)) return 'test';
    if (/\b(doc|readme|comment|documentation)\b/.test(text)) return 'docs';
    if (/\b(style|format|lint|prettier)\b/.test(text)) return 'style';
    if (/\b(feat|feature|add|implement|create)\b/.test(text)) return 'feature';

    return 'other';
  }

  private async extractFunction(filePath: string, functionName: string): Promise<string | null> {
    try {
      const uri = vscode.Uri.file(filePath);
      const content = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf-8');

      // Simple extraction - find function by name
      const lines = content.split('\n');
      let inFunction = false;
      let braceCount = 0;
      const funcLines: string[] = [];

      for (const line of lines) {
        if (!inFunction) {
          if (new RegExp(`(function\\s+${functionName}|const\\s+${functionName}\\s*=|${functionName}\\s*\\(`).test(line)) {
            inFunction = true;
          }
        }

        if (inFunction) {
          funcLines.push(line);
          braceCount += (line.match(/{/g) || []).length;
          braceCount -= (line.match(/}/g) || []).length;

          if (braceCount === 0 && funcLines.length > 1) break;
        }
      }

      return funcLines.length > 1 ? funcLines.join('\n') : null;
    } catch {
      return null;
    }
  }

  private async generateEvolutionSummary(functionName: string, events: EvolutionEvent[]): Promise<string> {
    if (events.length < 2) return 'Not enough history for evolution analysis.';

    const categories = events.map(e => e.category);
    const categoryCounts: Record<string, number> = {};
    for (const c of categories) categoryCounts[c] = (categoryCounts[c] || 0) + 1;

    const topCategory = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0];

    try {
      const prompt = `Summarize the evolution of function "${functionName}" in 2-3 sentences:

History (${events.length} commits):
${events.slice(0, 10).map(e => `- ${e.date.slice(0,10)} [${e.category}] ${e.semanticSummary}`).join('\n')}

Dominant category: ${topCategory[0]} (${topCategory[1]}x)

Write a concise narrative of how this function evolved.`;

      const response = await chat(
        [{ role: 'user', content: prompt }],
        { maxTokens: 150, temperature: 0.2 }
      );

      return response.trim();
    } catch {
      return `Function evolved through ${events.length} commits. Main focus: ${topCategory[0]} (${topCategory[1]}x).`;
    }
  }

  async showEvolutionUI(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('Open a file first');
      return;
    }

    const filePath = editor.document.uri.fsPath;

    // Ask for function name (optional)
    const functionName = await vscode.window.showInputBox({
      placeHolder: 'Function name (optional - analyzes whole file if empty)',
      prompt: 'Enter function name to track its evolution, or leave empty for file-level',
    });

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: '🧬 Analyzing code evolution...' },
      async () => {
        let result: string;

        if (functionName) {
          const evolution = await this.analyzeFunctionEvolution(filePath, functionName);
          if (!evolution) {
            vscode.window.showInformationMessage('Function not found or no history');
            return;
          }
          result = this.formatFunctionEvolution(evolution);
        } else {
          const events = await this.analyzeFileEvolution(filePath);
          if (events.length === 0) {
            vscode.window.showInformationMessage('No git history for this file');
            return;
          }
          result = this.formatFileEvolution(filePath, events);
        }

        // Show in webview
        const panel = vscode.window.createWebviewPanel(
          'codeGenetics',
          'Code Genetics: Evolution',
          vscode.ViewColumn.Two,
          { enableScripts: true }
        );

        panel.webview.html = this.getEvolutionHtml(result);
      }
    );
  }

  private formatFileEvolution(filePath: string, events: EvolutionEvent[]): string {
    const relPath = vscode.workspace.asRelativePath(filePath);
    let html = `<h2>🧬 Evolution: ${relPath}</h2><p>${events.length} commits analyzed</p>`;

    const categoryIcons: Record<EvolutionEvent['category'], string> = {
      feature: '✨',
      refactor: '♻️',
      fix: '🐛',
      test: '🧪',
      docs: '📝',
      style: '🎨',
      other: '📦',
    };

    html += '<div class="timeline">';
    for (const event of events) {
      const icon = categoryIcons[event.category] || '📦';
      html += `
        <div class="event">
          <div class="event-header">
            <span class="badge ${event.category}">${icon} ${event.category.toUpperCase()}</span>
            <span class="commit">${event.commit}</span>
            <span class="date">${event.date.slice(0, 10)}</span>
            <span class="author">${event.author}</span>
          </div>
          <div class="message">${event.message}</div>
          <div class="semantic">${event.semanticSummary}</div>
        </div>
      `;
    }
    html += '</div>';
    return html;
  }

  private formatFunctionEvolution(evolution: FunctionEvolution): string {
    let html = `
      <h2>🧬 Evolution: ${evolution.name}</h2>
      <p class="file">${evolution.filePath}</p>
      <div class="summary">${evolution.summary}</div>
      <h3>Current Code</h3>
      <pre><code>${this.escapeHtml(evolution.currentCode)}</code></pre>
      <h3>History (${evolution.events.length} commits)</h3>
      <div class="timeline">
    `;

    const categoryIcons: Record<EvolutionEvent['category'], string> = {
      feature: '✨',
      refactor: '♻️',
      fix: '🐛',
      test: '🧪',
      docs: '📝',
      style: '🎨',
      other: '📦',
    };

    for (const event of evolution.events) {
      const icon = categoryIcons[event.category] || '📦';
      html += `
        <div class="event">
          <div class="event-header">
            <span class="badge ${event.category}">${icon} ${event.category.toUpperCase()}</span>
            <span class="commit">${event.commit}</span>
            <span class="date">${event.date.slice(0, 10)}</span>
            <span class="author">${event.author}</span>
          </div>
          <div class="message">${event.message}</div>
          <div class="semantic">${event.semanticSummary}</div>
        </div>
      `;
    }
    html += '</div>';
    return html;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private getEvolutionHtml(content: string): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <style>
    body {
      font-family: var(--vscode-font-family);
      background: var(--vscode-editor-background);
      color: var(--vscode-foreground);
      padding: 16px;
      font-size: 13px;
      line-height: 1.6;
    }
    h2 { color: var(--vscode-terminal-ansiGreen); margin-bottom: 8px; }
    h3 { margin-top: 20px; margin-bottom: 8px; font-size: 14px; }
    .file { opacity: 0.7; font-size: 12px; font-family: monospace; }
    .summary { background: var(--vscode-editor-inactiveSelectionBackground); padding: 12px; border-radius: 6px; margin: 12px 0; }
    pre { background: var(--vscode-editor-inactiveSelectionBackground); padding: 12px; border-radius: 6px; overflow-x: auto; }
    code { font-family: var(--vscode-editor-font-family); font-size: 12px; }
    .timeline { display: flex; flex-direction: column; gap: 12px; }
    .event {
      background: var(--vscode-editor-inactiveSelectionBackground);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      padding: 12px;
    }
    .event-header { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; align-items: center; }
    .badge {
      padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: bold;
      text-transform: uppercase;
    }
    .badge.feature { background: #4ec9b0; color: #1e1e2e; }
    .badge.refactor { background: #dcdcaa; color: #1e1e2e; }
    .badge.fix { background: #f44747; color: white; }
    .badge.test { background: #9cdcfe; color: #1e1e2e; }
    .badge.docs { background: #ce9178; color: #1e1e2e; }
    .badge.style { background: #c586c0; color: white; }
    .badge.other { background: #858585; color: white; }
    .commit { font-family: monospace; background: var(--vscode-badge-background); padding: 1px 6px; border-radius: 3px; }
    .date { opacity: 0.6; font-size: 11px; }
    .author { opacity: 0.6; font-size: 11px; }
    .message { font-weight: 500; margin-bottom: 4px; }
    .semantic { font-style: italic; opacity: 0.8; color: var(--vscode-terminal-ansiGreen); }
  </style>
</head>
<body>
  ${content}
</body>
</html>
    `;
  }
}