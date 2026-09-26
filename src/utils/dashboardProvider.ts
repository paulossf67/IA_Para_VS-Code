import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { QualityScoreTracker } from './qualityScore';
import { BugDetective } from './bugDetective';
import { PerformanceProfiler } from './performanceProfiler';

export interface ProjectMetrics {
  totalFiles: number;
  linesOfCode: number;
  languages: { [key: string]: number };
  avgComplexity: number;
  testsFound: number;
  docCoverage: number;
  lastAnalyzed: string;
}

export interface DashboardData {
  project: ProjectMetrics;
  quality: {
    averageScore: number;
    trend: number;
    topCategory: string;
    bottomCategory: string;
    totalResponses: number;
  };
  bugs: {
    critical: number;
    warning: number;
    info: number;
    riskScore: number;
    lastScan: string;
  };
  performance: {
    critical: number;
    warning: number;
    issues: string[];
  };
}

export class DashboardProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'local-ai.dashboard';
  private _view?: vscode.WebviewView;
  private data: DashboardData | null = null;
  private qualityTracker: QualityScoreTracker;
  private bugDetective: BugDetective;
  private perfProfiler: PerformanceProfiler;

  constructor(
    private extensionUri: vscode.Uri,
    private context: vscode.ExtensionContext
  ) {
    this.qualityTracker = new QualityScoreTracker(context.globalState);
    this.bugDetective = new BugDetective();
    this.perfProfiler = new PerformanceProfiler();
  }

  public async resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    await this.refreshAll();
    webviewView.webview.html = this.getHtmlContent();

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === 'refresh') {
        await this.refreshAll();
        this._view?.webview.postMessage({ type: 'update', data: this.data });
      } else if (msg.type === 'scanBugs') {
        await this.scanBugs();
        this._view?.webview.postMessage({ type: 'update', data: this.data });
      } else if (msg.type === 'scanPerformance') {
        await this.scanPerformance();
        this._view?.webview.postMessage({ type: 'update', data: this.data });
      }
    });
  }

  private async refreshAll(): Promise<void> {
    await Promise.all([
      this.updateProjectMetrics(),
      this.updateQualityMetrics(),
      this.updateBugMetrics(),
      this.updatePerformanceMetrics(),
    ]);
  }

  private async updateProjectMetrics(): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return;

    const rootPath = workspaceFolders[0].uri.fsPath;
    const files = await vscode.workspace.findFiles(
      '**/*.{ts,js,tsx,jsx,py,java,go,rs,cpp,c,h,cs,rb,php}',
      '**/{node_modules,.git,dist,build,out,.next,target,vendor}/**',
      200
    );

    let totalLoc = 0;
    const languages: { [key: string]: number } = {};
    let testCount = 0;
    let documented = 0;
    let documentable = 0;

    for (const file of files) {
      const ext = path.extname(file.fsPath).slice(1);
      languages[ext] = (languages[ext] || 0) + 1;

      try {
        const content = fs.readFileSync(file.fsPath, 'utf-8');
        const lines = content.split('\n');
        totalLoc += lines.length;

        if (/\.(test|spec)\./.test(file.fsPath)) {
          testCount++;
        }

        for (let i = 0; i < lines.length; i++) {
          if (!/^\s*(export\s+)?(async\s+)?(function|class|interface|def |public |type |const |let |var )/.test(lines[i])) {
            continue;
          }
          documentable++;
          const prev = (lines[i - 1] ?? '').trim();
          if (prev.startsWith('*') || prev.startsWith('//') || prev.startsWith('"""') || prev.startsWith('#')) {
            documented++;
          }
        }
      } catch {}
    }

    this.data = {
      ...this.data!,
      project: {
        totalFiles: files.length,
        linesOfCode: totalLoc,
        languages,
        avgComplexity: Math.floor(totalLoc / Math.max(1, files.length - testCount) / 50),
        testsFound: testCount,
        docCoverage: documentable > 0 ? Math.round((documented / documentable) * 100) : 0,
        lastAnalyzed: new Date().toLocaleString(),
      },
    } as DashboardData;
  }

  private async updateQualityMetrics(): Promise<void> {
    const stats = await this.qualityTracker.getWeeklyStats();
    const allMetrics = await this.qualityTracker.loadMetrics();

    this.data = {
      ...this.data!,
      quality: {
        averageScore: stats.averageScore,
        trend: stats.trend,
        topCategory: stats.topCategory,
        bottomCategory: stats.bottomCategory,
        totalResponses: allMetrics.length,
      },
    } as DashboardData;
  }

  private async updateBugMetrics(): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return;

    // Quick scan of main files for bug patterns
    const files = await vscode.workspace.findFiles(
      '**/*.{ts,js,tsx,jsx,py}',
      '**/{node_modules,.git,dist,build}/**',
      20
    );

    let totalCritical = 0;
    let totalWarning = 0;
    let totalInfo = 0;
    let maxRisk = 0;

    for (const file of files) {
      try {
        const content = fs.readFileSync(file.fsPath, 'utf-8');
        const analysis = await this.bugDetective.analyzeCode(content, file.fsPath.split('.').pop() || 'typescript');

        for (const p of analysis.patterns) {
          if (p.severity === 'critical') totalCritical += p.detectedCount;
          else if (p.severity === 'warning') totalWarning += p.detectedCount;
          else totalInfo += p.detectedCount;
        }
        maxRisk = Math.max(maxRisk, analysis.riskScore);
      } catch {}
    }

    this.data = {
      ...this.data!,
      bugs: {
        critical: totalCritical,
        warning: totalWarning,
        info: totalInfo,
        riskScore: maxRisk,
        lastScan: new Date().toLocaleString(),
      },
    } as DashboardData;
  }

  private async scanBugs(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const code = editor.document.getText();
    const language = editor.document.languageId;

    const analysis = await this.bugDetective.analyzeCode(code, language);
    await this.bugDetective.showAnalysisReport(analysis);

    this.data!.bugs = {
      critical: analysis.patterns.filter(p => p.severity === 'critical').reduce((a, p) => a + p.detectedCount, 0),
      warning: analysis.patterns.filter(p => p.severity === 'warning').reduce((a, p) => a + p.detectedCount, 0),
      info: analysis.patterns.filter(p => p.severity === 'info').reduce((a, p) => a + p.detectedCount, 0),
      riskScore: analysis.riskScore,
      lastScan: new Date().toLocaleString(),
    };
  }

  private async updatePerformanceMetrics(): Promise<void> {
    this.data = {
      ...this.data!,
      performance: {
        critical: 0,
        warning: 0,
        issues: [],
      },
    } as DashboardData;
  }

  private async scanPerformance(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;

    const code = editor.document.getText();
    const language = editor.document.languageId;

    const issues = await this.perfProfiler.analyzeCode(code, language);
    await this.perfProfiler.showReport(issues);

    this.data!.performance = {
      critical: issues.filter(i => i.severity === 'critical').length,
      warning: issues.filter(i => i.severity === 'warning').length,
      issues: issues.map(i => i.issue),
    };
  }

  private getHtmlContent(): string {
    if (!this.data) {
      return '<html><body style="padding: 16px; font-family: var(--vscode-font-family);">Carregando dashboard...</body></html>';
    }

    const { project, quality, bugs, performance } = this.data;

    const riskColor = bugs.riskScore >= 80 ? '#ff4444' : bugs.riskScore >= 50 ? '#ffaa00' : bugs.riskScore >= 30 ? '#ffcc00' : '#4ec9b0';
    const qualityColor = quality.averageScore >= 80 ? '#4ec9b0' : quality.averageScore >= 60 ? '#ffaa00' : '#ff4444';

    return `
<!DOCTYPE html>
<html>
<head>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: var(--vscode-editor-background);
      color: var(--vscode-foreground);
      font-family: var(--vscode-font-family);
      padding: 16px;
      font-size: 13px;
      line-height: 1.5;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .header h1 { font-size: 18px; }
    .btn {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 6px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
    }
    .btn:hover { background: var(--vscode-button-hoverBackground); }
    .btn.secondary { background: var(--vscode-button-secondaryBackground); }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    @media (max-width: 600px) { .grid { grid-template-columns: 1fr; } }
    .card {
      background: var(--vscode-editor-inactiveSelectionBackground);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      padding: 12px;
    }
    .card h2 { font-size: 14px; margin-bottom: 10px; display: flex; align-items: center; gap: 8px; }
    .metric {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 0;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .metric:last-child { border-bottom: none; }
    .label { opacity: 0.8; }
    .value { font-weight: bold; }
    .value.good { color: #4ec9b0; }
    .value.warning { color: #ffaa00; }
    .value.critical { color: #ff4444; }
    .value.info { color: #569cd6; }
    .progress-bar {
      width: 100%;
      height: 6px;
      background: var(--vscode-input-background);
      border-radius: 3px;
      overflow: hidden;
      margin-top: 4px;
    }
    .progress-fill {
      height: 100%;
      border-radius: 3px;
      transition: width 0.3s;
    }
    .bug-item, .perf-item {
      padding: 8px 0;
      border-bottom: 1px solid var(--vscode-panel-border);
      font-size: 12px;
    }
    .bug-item:last-child, .perf-item:last-child { border-bottom: none; }
    .severity-badge {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 10px;
      font-weight: bold;
      margin-right: 8px;
    }
    .severity-critical { background: #ff4444; color: white; }
    .severity-warning { background: #ffaa00; color: black; }
    .severity-info { background: #569cd6; color: white; }
    .lang-list { display: flex; flex-wrap: wrap; gap: 6px; }
    .lang-tag {
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      padding: 2px 8px;
      border-radius: 10px;
      font-size: 11px;
    }
    .timestamp { font-size: 11px; opacity: 0.6; margin-top: 8px; }
    .empty { text-align: center; opacity: 0.5; padding: 20px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>📊 Local AI Quality Dashboard</h1>
    <div>
      <button class="btn secondary" onclick="send('refresh')">🔄 Refresh</button>
      <button class="btn" onclick="send('scanBugs')">🐛 Scan Bugs</button>
      <button class="btn" onclick="send('scanPerformance')">⚡ Scan Perf</button>
    </div>
  </div>

  <div class="grid">
    <div class="card">
      <h2>📈 Project Metrics</h2>
      <div class="metric">
        <span class="label">Files</span>
        <span class="value good">${project.totalFiles}</span>
      </div>
      <div class="metric">
        <span class="label">Lines of Code</span>
        <span class="value good">${project.linesOfCode.toLocaleString()}</span>
      </div>
      <div class="metric">
        <span class="label">Avg Complexity</span>
        <span class="value ${project.avgComplexity > 50 ? 'warning' : 'good'}">${project.avgComplexity}</span>
      </div>
      <div class="metric">
        <span class="label">Tests Found</span>
        <span class="value info">${project.testsFound}</span>
      </div>
    </div>

    <div class="card">
      <h2>📚 Doc Coverage</h2>
      <div class="metric">
        <span class="label">Coverage</span>
        <span class="value ${project.docCoverage >= 70 ? 'good' : project.docCoverage >= 40 ? 'warning' : 'critical'}">${project.docCoverage}%</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" style="width: ${project.docCoverage}%; background: ${project.docCoverage >= 70 ? '#4ec9b0' : project.docCoverage >= 40 ? '#ffaa00' : '#ff4444'}"></div>
      </div>
    </div>
  </div>

  <div class="grid" style="margin-top: 12px;">
    <div class="card">
      <h2>🤖 AI Quality Score</h2>
      <div class="metric">
        <span class="label">Avg Score (Week)</span>
        <span class="value" style="color: ${qualityColor}">${quality.averageScore.toFixed(1)}/100</span>
      </div>
      <div class="metric">
        <span class="label">Trend</span>
        <span class="value ${quality.trend > 0 ? 'good' : quality.trend < 0 ? 'critical' : 'info'}">
          ${quality.trend > 0 ? '📈' : quality.trend < 0 ? '📉' : '➡️'} ${Math.abs(quality.trend)}%
        </span>
      </div>
      <div class="metric">
        <span class="label">Total Responses</span>
        <span class="value info">${quality.totalResponses}</span>
      </div>
      <div class="metric">
        <span class="label">Best Category</span>
        <span class="value good">${quality.topCategory || 'N/A'}</span>
      </div>
      <div class="metric">
        <span class="label">Needs Work</span>
        <span class="value warning">${quality.bottomCategory || 'N/A'}</span>
      </div>
    </div>

    <div class="card">
      <h2>🐛 Bug Risk</h2>
      <div class="metric">
        <span class="label">Risk Score</span>
        <span class="value" style="color: ${riskColor}">${bugs.riskScore}/100</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" style="width: ${bugs.riskScore}%; background: ${riskColor}"></div>
      </div>
      <div class="metric">
        <span class="label">Critical</span>
        <span class="value critical">🔴 ${bugs.critical}</span>
      </div>
      <div class="metric">
        <span class="label">Warning</span>
        <span class="value warning">⚠️ ${bugs.warning}</span>
      </div>
      <div class="metric">
        <span class="label">Info</span>
        <span class="value info">ℹ️ ${bugs.info}</span>
      </div>
    </div>
  </div>

  <div class="card" style="margin-top: 12px;">
    <h2>🔤 Languages</h2>
    <div class="lang-list">
      ${Object.entries(project.languages)
        .sort((a, b) => b[1] - a[1])
        .map(([lang, count]) => `<span class="lang-tag">${lang}: ${count}</span>`)
        .join('')}
    </div>
  </div>

  <div class="card" style="margin-top: 12px;">
    <h2>⚡ Performance</h2>
    ${performance.issues.length === 0
      ? '<p class="empty">Run "Scan Performance" on a file to see issues</p>'
      : performance.issues.map((issue: string) => `
    <div class="perf-item">
      <span class="severity-badge severity-warning">WARNING</span>
      ${issue}
    </div>
      `).join('')}
  </div>

  <div class="timestamp">
    📅 Updated: ${project.lastAnalyzed} | Bugs scanned: ${bugs.lastScan}
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    function send(type) {
      vscode.postMessage({ type });
    }
  </script>
</body>
</html>
    `;
  }
}