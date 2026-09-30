import * as vscode from 'vscode';

export interface UsageStats {
  totalTokens: number;
  totalRequests: number;
  totalCost: number; // em USD (0 para local)
  byModel: Record<string, { tokens: number; requests: number; cost: number }>;
  byCategory: Record<string, { tokens: number; requests: number }>;
  daily: Record<string, { tokens: number; requests: number }>;
  lastUpdated: string;
}

export interface UsageEvent {
  timestamp: string;
  model: string;
  category: string; // 'chat', 'completion', 'explain', 'refactor', 'test', 'fix', 'docs'
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  durationMs: number;
  success: boolean;
}

const STORAGE_KEY = 'local-ai.usageStats';
const MAX_EVENTS = 10000;

export class UsageStatsTracker {
  private stats: UsageStats;
  private events: UsageEvent[] = [];

  constructor(private storage: vscode.Memento) {
    this.stats = this.getDefaultStats();
  }

  private getDefaultStats(): UsageStats {
    return {
      totalTokens: 0,
      totalRequests: 0,
      totalCost: 0,
      byModel: {},
      byCategory: {},
      daily: {},
      lastUpdated: new Date().toISOString(),
    };
  }

  async initialize(): Promise<void> {
    const saved = this.storage.get<{ stats: UsageStats; events: UsageEvent[] }>(STORAGE_KEY);
    if (saved) {
      this.stats = saved.stats;
      this.events = saved.events || [];
    }
  }

  async recordEvent(event: Omit<UsageEvent, 'timestamp'>): Promise<void> {
    const fullEvent: UsageEvent = {
      ...event,
      timestamp: new Date().toISOString(),
    };

    this.events.push(fullEvent);
    if (this.events.length > MAX_EVENTS) {
      this.events = this.events.slice(-MAX_EVENTS);
    }

    this.updateStats(fullEvent);
    await this.persist();
  }

  private updateStats(event: UsageEvent): void {
    this.stats.totalTokens += event.totalTokens;
    this.stats.totalRequests += 1;
    this.stats.lastUpdated = new Date().toISOString();

    const dateKey = event.timestamp.split('T')[0];

    // By model
    if (!this.stats.byModel[event.model]) {
      this.stats.byModel[event.model] = { tokens: 0, requests: 0, cost: 0 };
    }
    this.stats.byModel[event.model].tokens += event.totalTokens;
    this.stats.byModel[event.model].requests += 1;

    // By category
    if (!this.stats.byCategory[event.category]) {
      this.stats.byCategory[event.category] = { tokens: 0, requests: 0 };
    }
    this.stats.byCategory[event.category].tokens += event.totalTokens;
    this.stats.byCategory[event.category].requests += 1;

    // Daily
    if (!this.stats.daily[dateKey]) {
      this.stats.daily[dateKey] = { tokens: 0, requests: 0 };
    }
    this.stats.daily[dateKey].tokens += event.totalTokens;
    this.stats.daily[dateKey].requests += 1;
  }

  private async persist(): Promise<void> {
    await this.storage.update(STORAGE_KEY, {
      stats: this.stats,
      events: this.events,
    });
  }

  getStats(): UsageStats {
    return { ...this.stats };
  }

  getEvents(limit = 100): UsageEvent[] {
    return this.events.slice(-limit).reverse();
  }

  async clearHistory(): Promise<void> {
    this.stats = this.getDefaultStats();
    this.events = [];
    await this.persist();
  }

  async exportData(): Promise<string> {
    return JSON.stringify({ stats: this.stats, events: this.events }, null, 2);
  }

  async importData(json: string): Promise<void> {
    const data = JSON.parse(json);
    if (data.stats) this.stats = data.stats;
    if (data.events) this.events = data.events;
    await this.persist();
  }
}

export class UsageStatsProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'local-ai.usageStats';
  private _view?: vscode.WebviewView;
  private tracker: UsageStatsTracker;

  constructor(
    private extensionUri: vscode.Uri,
    private context: vscode.ExtensionContext
  ) {
    this.tracker = new UsageStatsTracker(context.globalState);
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

    await this.tracker.initialize();
    this.updateView();

    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case 'refresh':
          await this.tracker.initialize();
          this.updateView();
          break;
        case 'clear':
          await this.tracker.clearHistory();
          this.updateView();
          break;
        case 'export':
          const data = await this.tracker.exportData();
          const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(`usage-stats-${new Date().toISOString().split('T')[0]}.json`),
            filters: { JSON: ['json'] },
          });
          if (uri) {
            await vscode.workspace.fs.writeFile(uri, Buffer.from(data, 'utf-8'));
            vscode.window.showInformationMessage(`Estatísticas exportadas para ${uri.fsPath}`);
          }
          break;
        case 'clearModel':
          // Could implement per-model clearing
          break;
      }
    });
  }

  private updateView(): void {
    if (!this._view) return;

    const stats = this.tracker.getStats();
    const events = this.tracker.getEvents(50);

    this._view.webview.html = this._getHtml(stats, events);
  }

  private _getHtml(stats: UsageStats, events: UsageEvent[]): string {
    const totalCost = stats.totalCost.toFixed(4);
    const avgTokensPerReq = stats.totalRequests > 0 ? Math.round(stats.totalTokens / stats.totalRequests) : 0;

    // Top models
    const topModels = Object.entries(stats.byModel)
      .sort((a, b) => b[1].tokens - a[1].tokens)
      .slice(0, 5);

    // Top categories
    const topCategories = Object.entries(stats.byCategory)
      .sort((a, b) => b[1].tokens - a[1].tokens)
      .slice(0, 5);

    // Last 7 days
    const last7Days = Object.entries(stats.daily)
      .sort((a, b) => b[0].localeCompare(a[0]))
      .slice(0, 7)
      .reverse();

    return /*html*/ `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <title>Usage Stats</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 12px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .header h2 { font-size: 16px; font-weight: 600; }
    .btn {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: none;
      padding: 6px 12px;
      border-radius: 4px;
      cursor: pointer;
      font-size: 12px;
      font-family: inherit;
    }
    .btn:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .btn-danger { background: var(--vscode-inputValidation-errorBackground); color: var(--vscode-errorForeground); }
    
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 12px;
      margin-bottom: 16px;
    }
    .card {
      background: var(--vscode-editor-inactiveSelectionBackground);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 8px;
      padding: 16px;
    }
    .card h3 { font-size: 11px; opacity: 0.7; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
    .value { font-size: 24px; font-weight: 600; color: var(--vscode-terminal-ansiGreen); }
    .value.cost { color: var(--vscode-terminal-ansiYellow); }
    .value.requests { color: var(--vscode-terminal-ansiBlue); }
    
    .section {
      margin-bottom: 20px;
    }
    .section h3 { font-size: 13px; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
    
    .list { display: flex; flex-direction: column; gap: 8px; }
    .list-item {
      background: var(--vscode-editor-inactiveSelectionBackground);
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      padding: 10px 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .list-item-info { display: flex; flex-direction: column; gap: 2px; }
    .list-item-name { font-weight: 500; font-size: 13px; }
    .list-item-meta { font-size: 11px; opacity: 0.7; }
    .list-item-value { font-weight: 600; font-size: 13px; color: var(--vscode-terminal-ansiGreen); }
    
    .chart-bar {
      height: 6px;
      background: var(--vscode-progressBar-background, var(--vscode-button-background));
      border-radius: 3px;
      margin-top: 4px;
    }
    
    .events-table {
      font-size: 12px;
    }
    .events-table .header {
      display: grid;
      grid-template-columns: 80px 60px 60px 1fr 60px 60px;
      padding: 8px 12px;
      font-weight: 600;
      opacity: 0.7;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .events-table .row {
      display: grid;
      grid-template-columns: 80px 60px 60px 1fr 60px 60px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .row.success { opacity: 1; }
    .row.failed { opacity: 0.5; color: var(--vscode-errorForeground); }
    
    .btn-group { display: flex; gap: 8px; }
  </style>
</head>
<body>
  <div class="header">
    <h2>📊 Usage Statistics</h2>
    <div class="btn-group">
      <button class="btn" id="refreshBtn">🔄 Atualizar</button>
      <button class="btn" id="exportBtn">📤 Exportar</button>
      <button class="btn btn-danger" id="clearBtn">🗑 Limpar</button>
    </div>
  </div>

  <div class="grid">
    <div class="card">
      <h3>Total Tokens</h3>
      <div class="value">${stats.totalTokens.toLocaleString()}</div>
    </div>
    <div class="card">
      <h3>Total Requests</h3>
      <div class="value requests">${stats.totalRequests.toLocaleString()}</div>
    </div>
    <div class="card">
      <h3>Avg Tokens/Req</h3>
      <div class="value">${Math.round(stats.totalTokens / Math.max(1, stats.totalRequests))}</div>
    </div>
    <div class="card">
      <h3>Custo Estimado</h3>
      <div class="value cost">$${stats.totalCost.toFixed(4)}</div>
    </div>
  </div>

  <div class="section">
    <h3>🤖 Por Modelo</h3>
    <div class="list">
      ${Object.entries(stats.byModel).sort((a,b) => b[1].tokens - a[1].tokens).slice(0, 10).map(([model, data]) => `
      <div class="list-item">
        <div class="list-item-info">
          <span class="list-item-name">${model}</span>
          <span class="list-item-meta">${data.requests} requests • ${data.tokens.toLocaleString()} tokens</span>
        </div>
        <span class="list-item-value">${Math.round(data.tokens / Math.max(1, stats.totalTokens) * 100)}%</span>
      </div>
      `).join('')}
    </div>
  </div>

  <div class="section">
    <h3>📂 Por Categoria</h3>
    <div class="list">
      ${Object.entries(stats.byCategory).sort((a,b) => b[1].tokens - a[1].tokens).map(([cat, data]) => `
      <div class="list-item">
        <div class="list-item-info">
          <span class="list-item-name">${cat}</span>
          <span class="list-item-meta">${data.requests} requests • ${data.tokens.toLocaleString()} tokens</span>
        </div>
        <span class="list-item-value">${Math.round(data.tokens / Math.max(1, stats.totalTokens) * 100)}%</span>
      </div>
      `).join('')}
    </div>
  </div>

  <div class="section">
    <h3>📅 Últimos 7 Dias</h3>
    <div class="list">
      ${Object.entries(stats.daily).sort((a,b) => b[0].localeCompare(a[0])).slice(0, 7).reverse().map(([date, data]) => `
      <div class="list-item">
        <div class="list-item-info">
          <span class="list-item-name">${date}</span>
          <span class="list-item-meta">${data.requests} requests</span>
        </div>
        <span class="list-item-value">${data.tokens.toLocaleString()} tokens</span>
      </div>
      `).join('')}
    </div>
  </div>

  <div class="section">
    <h3>📋 Eventos Recentes</h3>
    <div class="events-table">
      <div class="header">
        <span>Hora</span>
        <span>Modelo</span>
        <span>Categoria</span>
        <span>Tokens</span>
        <span>Duração</span>
        <span>Status</span>
      </div>
      ${events.map(e => `
      <div class="row ${e.success ? 'success' : 'failed'}">
        <span>${new Date(e.timestamp).toLocaleTimeString()}</span>
        <span>${e.model}</span>
        <span>${e.category}</span>
        <span>${e.totalTokens}</span>
        <span>${e.durationMs}ms</span>
        <span>${e.success ? '✅' : '❌'}</span>
      </div>
      `).join('')}
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    
    document.getElementById('refreshBtn')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'refresh' });
    });
    
    document.getElementById('exportBtn')?.addEventListener('click', () => {
      vscode.postMessage({ type: 'export' });
    });
    
    document.getElementById('clearBtn')?.addEventListener('click', () => {
      if (confirm('Tem certeza que deseja limpar todo o histórico de uso?')) {
        vscode.postMessage({ type: 'clear' });
      }
    });
  </script>
</body>
</html>`;
  }
}

export function createUsageStatsCommands(
  context: vscode.ExtensionContext,
  tracker: UsageStatsTracker
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('local-ai.showUsageStats', async () => {
      await vscode.commands.executeCommand('local-ai.usageStats.focus');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('local-ai.clearUsageStats', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Tem certeza que deseja limpar todo o histórico de uso?',
        { modal: true },
        'Sim, limpar'
      );
      if (confirm === 'Sim, limpar') {
        await tracker.clearHistory();
        vscode.window.showInformationMessage('Histórico de uso limpo');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('local-ai.exportUsageStats', async () => {
      const data = await tracker.exportData();
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(`usage-stats-${new Date().toISOString().split('T')[0]}.json`),
        filters: { JSON: ['json'] },
      });
      if (uri) {
        await vscode.workspace.fs.writeFile(uri, Buffer.from(data, 'utf-8'));
        vscode.window.showInformationMessage(`Estatísticas exportadas para ${uri.fsPath}`);
      }
    })
  );
}