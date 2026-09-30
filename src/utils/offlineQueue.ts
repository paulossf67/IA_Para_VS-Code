import * as vscode from 'vscode';
import { chat, checkOllamaAvailable } from './ollama';
import { requiresOllama } from './multiAI';

export interface QueuedPrompt {
  id: string;
  text: string;
  images?: string[];
  signal?: AbortSignal;
  resolve?: (response: string | undefined) => void;
  reject?: (error: Error) => void;
  timestamp: string;
  priority: number; // lower = higher priority
  retries: number;
}

const STORAGE_KEY = 'local-ai.offlineQueue';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5000;
const HEALTH_CHECK_INTERVAL_MS = 30000;

export class OfflineQueueManager {
  private queue: QueuedPrompt[] = [];
  private isProcessing = false;
  private healthCheckTimer?: NodeJS.Timeout;
  private isOnline = false;
  private statusListeners: Set<(online: boolean) => void> = new Set();

  constructor(private storage: vscode.Memento) {
    this.load();
    this.startHealthCheck();
  }

  private load(): void {
    const saved = this.storage.get<QueuedPrompt[]>(STORAGE_KEY, []);
    this.queue = saved.map(q => ({
      ...q,
      timestamp: q.timestamp,
    }));
    // Re-queue any pending items
    for (const item of this.queue) {
      if (item.retries < 3) {
        this.processQueue();
      }
    }
  }

  private async persist(): Promise<void> {
    await this.storage.update(STORAGE_KEY, this.queue);
  }

  private startHealthCheck(): void {
    this.checkHealth();
    this.healthCheckTimer = setInterval(() => this.checkHealth(), HEALTH_CHECK_INTERVAL_MS);
  }

  private async checkHealth(): Promise<void> {
    const wasOnline = this.isOnline;
    this.isOnline = await checkOllamaAvailable();
    
    if (this.isOnline !== wasOnline) {
      this.notifyStatusChange(this.isOnline);
    }

    if (this.isOnline && !this.isProcessing) {
      this.processQueue();
    }
  }

  private notifyStatusChange(online: boolean): void {
    for (const listener of this.statusListeners) {
      listener(online);
    }
  }

  onStatusChange(listener: (online: boolean) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  isOllamaOnline(): boolean {
    return this.isOnline;
  }

  async enqueue(prompt: QueuedPrompt): Promise<string | undefined> {
    return new Promise((resolve, reject) => {
      const item: QueuedPrompt = {
        ...prompt,
        id: `prompt-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        timestamp: new Date().toISOString(),
        retries: 0,
      };

      this.queue.push(item);
      this.queue.sort((a, b) => a.priority - b.priority);
      this.persist();

      item.resolve = resolve;
      item.reject = reject;

      if (this.isOnline) {
        this.processQueue();
      } else {
        vscode.window.showInformationMessage(
          `Ollama offline. Prompt enfileirado (${this.queue.length} na fila). Será processado quando o Ollama voltar.`
        );
      }
    });
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0 || !this.isOnline) return;

    this.isProcessing = true;

    while (this.queue.length > 0 && this.isOnline) {
      const item = this.queue.shift()!;
      
      try {
        // Update retry count
        item.retries++;
        
        // Send to Ollama
        const response = await this.sendToOllama(item);
        
        if (response !== undefined) {
          item.resolve?.(response);
        } else {
          item.reject?.(new Error('Resposta vazia'));
        }
      } catch (error: any) {
        if (item.retries < 3) {
          // Re-queue with exponential backoff
          item.priority += 10; // Lower priority for retries
          this.queue.unshift(item);
          
          // Wait before retry
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS * item.retries));
        } else {
          item.reject?.(error);
          vscode.window.showErrorMessage(`Prompt falhou após 3 tentativas: ${error.message}`);
        }
      }
      
      await this.persist();
    }

    this.isProcessing = false;
  }

  private async sendToOllama(item: QueuedPrompt): Promise<string | undefined> {
    if (item.images && item.images.length > 0) {
      // Use chat with images
      return chat(
        [
          { role: 'user', content: item.text },
          // Note: images would need special handling
        ],
        { signal: item.signal }
      );
    } else {
      return chat([{ role: 'user', content: item.text }], { signal: item.signal });
    }
  }

  getQueueStatus(): { length: number; isOnline: boolean; isProcessing: boolean } {
    return {
      length: this.queue.length,
      isOnline: this.isOnline,
      isProcessing: this.isProcessing,
    };
  }

  getQueue(): QueuedPrompt[] {
    return [...this.queue];
  }

  async clear(): Promise<void> {
    for (const item of this.queue) {
      item.reject?.(new Error('Queue cleared by user'));
    }
    this.queue = [];
    await this.persist();
  }

  async retryAll(): Promise<void> {
    for (const item of this.queue) {
      item.retries = 0;
      item.priority = 0;
    }
    this.queue.sort((a, b) => a.priority - b.priority);
    await this.persist();
    if (this.isOnline) {
      this.processQueue();
    }
  }

  dispose(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }
  }
}

export class OfflineQueueProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'local-ai.offlineQueue';
  private _view?: vscode.WebviewView;
  private manager: OfflineQueueManager;
  private statusUnsubscribe?: () => void;

  constructor(
    private extensionUri: vscode.Uri,
    private storage: vscode.Memento
  ) {
    this.manager = new OfflineQueueManager(storage);
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this._getHtml(this.manager.getQueue(), this.manager.getQueueStatus());

    webviewView.onDidDispose(() => {
      this._view = undefined;
      this.statusUnsubscribe?.();
    });

    this.statusUnsubscribe = this.manager.onStatusChange(online => {
      this._view?.webview.postMessage({ type: 'status', online });
    });

    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case 'retryAll':
          await this.manager.retryAll();
          this.updateView();
          break;
        case 'clear':
          await this.manager.clear();
          this.updateView();
          break;
        case 'retry':
          await this.retryItem(data.id);
          break;
        case 'remove':
          await this.removeItem(data.id);
          break;
        case 'refresh':
          this.updateView();
          break;
      }
    });

    this.updateView();
  }

  private async retryItem(id: string): Promise<void> {
    // Implementation would retry a specific item
    this.updateView();
  }

  private async removeItem(id: string): Promise<void> {
    // Implementation would remove a specific item
    this.updateView();
  }

  private updateView(): void {
    if (!this._view) return;

    const queue = this.manager.getQueue();
    const status = this.manager.getQueueStatus();

    this._view.webview.html = this._getHtml(queue, status);
  }

  private _getHtml(
    queue: any[] = [],
    status: { length: number; isOnline: boolean; isProcessing: boolean } = {
      length: 0,
      isOnline: false,
      isProcessing: false,
    }
  ): string {
    return /*html*/ `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <title>Offline Queue</title>
  <style>
    :root {
      --bg: var(--vscode-sideBar-background);
      --fg: var(--vscode-foreground);
      --button-bg: var(--vscode-button-background);
      --button-fg: var(--vscode-button-foreground);
      --button-hover: var(--vscode-button-hoverBackground);
      --button2-bg: var(--vscode-button-secondaryBackground);
      --button2-fg: var(--vscode-button-secondaryForeground);
      --input-bg: var(--vscode-input-background);
      --input-fg: var(--vscode-input-foreground);
      --border: var(--vscode-panel-border);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--fg); background: var(--bg); height: 100vh; display: flex; flex-direction: column; }
    .header { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border-bottom: 1px solid var(--border); }
    .header h2 { font-size: 14px; }
    .status { display: flex; align-items: center; gap: 8px; font-size: 12px; }
    .status-indicator { width: 8px; height: 8px; border-radius: 50%; background: var(--vscode-charts-red); }
    .status-indicator.online { background: var(--vscode-charts-green); }
    .status-indicator.processing { background: var(--vscode-charts-yellow); animation: pulse 1s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    .toolbar { display: flex; gap: 6px; padding: 8px 12px; border-bottom: 1px solid var(--border); }
    .btn { background: var(--button2-bg); color: var(--button2-fg); border: none; padding: 6px 10px; border-radius: 4px; cursor: pointer; font-size: 11px; }
    .btn:hover { background: var(--button2-hover); }
    .queue-list { flex: 1; overflow-y: auto; padding: 8px; }
    .queue-item { background: var(--vscode-editor-inactiveSelectionBackground); border: 1px solid var(--border); border-radius: 6px; padding: 10px 12px; margin-bottom: 6px; }
    .queue-item-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
    .queue-item-text { font-size: 12px; opacity: 0.9; white-space: pre-wrap; word-break: break-word; margin-bottom: 8px; }
    .queue-item-meta { font-size: 11px; opacity: 0.7; display: flex; gap: 12px; }
    .queue-actions { display: flex; gap: 6px; }
    .btn-small { padding: 3px 8px; font-size: 11px; border-radius: 4px; border: none; cursor: pointer; font-family: inherit; }
    .btn-retry { background: var(--button-bg); color: var(--button-fg); }
    .btn-remove { background: var(--vscode-inputValidation-errorBackground); color: var(--vscode-errorForeground); }
    .empty-state { text-align: center; padding: 40px 20px; opacity: 0.6; }
    .status-badge { padding: 2px 6px; border-radius: 10px; font-size: 10px; font-weight: 600; }
    .status-online { background: var(--vscode-charts-green); color: white; }
    .status-offline { background: var(--vscode-charts-red); color: white; }
    .status-processing { background: var(--vscode-charts-yellow); color: black; }
  </style>
</head>
<body>
  <div class="header">
    <h2>📦 Offline Queue</h2>
    <div class="status">
      <span class="status-indicator ${status.isOnline ? 'online' : 'offline'}" id="statusIndicator"></span>
      <span id="statusText">${status.isOnline ? 'Online' : 'Offline'}</span>
      ${status.isProcessing ? '<span class="status-badge status-processing">Processando...</span>' : ''}
      <span class="status-badge">${status.length} na fila</span>
    </div>
  </div>
  <div class="toolbar">
    <button class="btn" id="retryAllBtn" ${queue.length === 0 ? 'disabled' : ''}>🔄 Retentar Todos</button>
    <button class="btn" id="clearBtn" ${queue.length === 0 ? 'disabled' : ''}>🗑 Limpar Fila</button>
    <button class="btn" id="refreshBtn">🔄 Atualizar</button>
  </div>
  <div class="queue-list" id="queueList">
    ${queue.length === 0 ? '<div class="empty-state">Fila vazia</div>' : queue.map(item => `
    <div class="queue-item" data-id="${item.id}">
      <div class="queue-item-header">
        <span class="status-badge ${item.retries > 0 ? 'status-processing' : 'status-online'}">Tentativa ${item.retries + 1}/3</span>
        <span>${new Date(item.timestamp).toLocaleTimeString()}</span>
      </div>
      <div class="queue-item-text">${item.text.slice(0, 200)}${item.text.length > 200 ? '...' : ''}</div>
      <div class="queue-item-meta">
        <span>Prioridade: ${item.priority}</span>
        <span>Tentativas: ${item.retries}/3</span>
      </div>
      <div class="queue-actions">
        <button class="btn-small btn-retry" data-id="${item.id}" data-action="retry">🔄 Retentar</button>
        <button class="btn-small btn-remove" data-id="${item.id}" data-action="remove">🗑 Remover</button>
      </div>
    </div>
    `).join('')}
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const queueList = document.getElementById('queueList');
    const retryAllBtn = document.getElementById('retryAllBtn');
    const clearBtn = document.getElementById('clearBtn');
    const refreshBtn = document.getElementById('refreshBtn');

    function showError(msg) {
      const toast = document.createElement('div');
      toast.style.cssText = 'position:fixed;bottom:16px;left:16px;right:16px;background:var(--vscode-inputValidation-errorBackground);color:var(--vscode-errorForeground);padding:12px;border-radius:6px;z-index:100';
      toast.textContent = msg;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 3000);
    }

    retryAllBtn.addEventListener('click', () => vscode.postMessage({ type: 'retryAll' }));
    clearBtn.addEventListener('click', async () => {
      if (confirm('Limpar toda a fila?')) {
        vscode.postMessage({ type: 'clear' });
      }
    });
    refreshBtn.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));

    queueList.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const id = btn.dataset.id;
      if (btn.dataset.action === 'retry') {
        vscode.postMessage({ type: 'retry', id });
      } else if (btn.dataset.action === 'remove') {
        vscode.postMessage({ type: 'remove', id });
      }
    });

    window.addEventListener('message', (event) => {
      const data = event.data;
      if (data.type === 'status') {
        document.getElementById('statusText').textContent = data.online ? 'Online' : 'Offline';
        const indicator = document.getElementById('statusIndicator');
        indicator.className = 'status-indicator ' + (data.online ? 'online' : 'offline');
        if (data.processing) indicator.classList.add('processing');
      }
    });
  </script>
</body>
</html>`;
  }
}

export function createOfflineQueueCommands(context: vscode.ExtensionContext, manager: any): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('local-ai.showOfflineQueue', async () => {
      await vscode.commands.executeCommand('local-ai.offlineQueue.focus');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('local-ai.retryOfflineQueue', async () => {
      await manager.retryAll();
      vscode.window.showInformationMessage('Todas as tentativas resetadas');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('local-ai.clearOfflineQueue', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Limpar toda a fila offline?',
        { modal: true },
        'Sim, limpar'
      );
      if (confirm === 'Sim, limpar') {
        await manager.clear();
        vscode.window.showInformationMessage('Fila offline limpa');
      }
    })
  );
}