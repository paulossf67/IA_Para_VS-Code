import * as vscode from 'vscode';
import { listModels, pullModel, deleteModel, checkOllamaAvailable, getConfig } from '../utils/ollama';

export class ModelManagerProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'local-ai.modelManager';
  private _view?: vscode.WebviewView;
  private models: string[] = [];
  private currentModel: string = '';
  private isLoading = false;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtml(webviewView.webview);

    webviewView.onDidDispose(() => {
      this._view = undefined;
    });

    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case 'ready':
          await this.refreshModels();
          break;
        case 'selectModel':
          await this.selectModel(data.model);
          break;
        case 'pullModel':
          await this.pullModel(data.model);
          break;
        case 'deleteModel':
          await this.deleteModel(data.model);
          break;
        case 'refresh':
          await this.refreshModels();
          break;
      }
    });

    // Initial load
    this.refreshModels();
  }

  private async refreshModels(): Promise<void> {
    if (this.isLoading) return;
    this.isLoading = true;
    this._view?.webview.postMessage({ type: 'loading', loading: true });

    try {
      const available = await checkOllamaAvailable();
      if (!available) {
        this._view?.webview.postMessage({ 
          type: 'error', 
          message: 'Ollama não está rodando. Inicie com "ollama serve".' 
        });
        this.isLoading = false;
        return;
      }

      this.models = await listModels();
      this.currentModel = getConfig().model;
      this._view?.webview.postMessage({ 
        type: 'models', 
        models: this.models,
        currentModel: this.currentModel 
      });
    } catch (err: any) {
      this._view?.webview.postMessage({ 
        type: 'error', 
        message: `Erro ao carregar modelos: ${err.message}` 
      });
    } finally {
      this.isLoading = false;
      this._view?.webview.postMessage({ type: 'loading', loading: false });
    }
  }

  private async selectModel(model: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('local-ai');
    await config.update('model', model, vscode.ConfigurationTarget.Global);
    this.currentModel = model;
    this._view?.webview.postMessage({ type: 'selected', model });
    vscode.window.showInformationMessage(`Modelo alterado para: ${model}`);
  }

  private async pullModel(model: string): Promise<void> {
    if (this.isLoading) return;
    this.isLoading = true;
    this._view?.webview.postMessage({ type: 'pulling', model, loading: true });

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Baixando modelo ${model}...`,
          cancellable: false,
        },
        async (progress) => {
          // Note: ollama.ts doesn't expose pullModel directly, we'll use the Ollama API
          const { url } = getConfig();
          const response = await fetch(`${url}/api/pull`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: model, stream: true }),
          });

          if (!response.ok) {
            throw new Error(`Erro ao baixar: ${response.status}`);
          }

          // Read streaming response for progress
          const reader = response.body?.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          if (reader) {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';
              for (const line of lines) {
                if (line.trim()) {
                  try {
                    const data = JSON.parse(line);
                    if (data.status) {
                      progress.report({ message: data.status });
                    }
                  } catch {}
                }
              }
            }
          }
        }
      );

      await this.refreshModels();
      vscode.window.showInformationMessage(`Modelo ${model} baixado com sucesso!`);
    } catch (err: any) {
      this._view?.webview.postMessage({ 
        type: 'error', 
        message: `Erro ao baixar modelo: ${err.message}` 
      });
    } finally {
      this.isLoading = false;
      this._view?.webview.postMessage({ type: 'pulling', model, loading: false });
    }
  }

  private async deleteModel(model: string): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
      `Tem certeza que deseja remover o modelo "${model}"?`,
      { modal: true },
      'Sim, remover'
    );

    if (confirm !== 'Sim, remover') return;

    try {
      const { url } = getConfig();
      const response = await fetch(`${url}/api/delete`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: model }),
      });

      if (!response.ok) {
        throw new Error(`Erro ao remover: ${response.status}`);
      }

      await this.refreshModels();
      vscode.window.showInformationMessage(`Modelo ${model} removido!`);
    } catch (err: any) {
      this._view?.webview.postMessage({ 
        type: 'error', 
        message: `Erro ao remover modelo: ${err.message}` 
      });
    }
  }

  private _getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'chat', 'chat.css'));

    return /*html*/ `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <title>Model Manager</title>
  <link rel="stylesheet" href="${styleUri}">
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
      --error-bg: var(--vscode-inputValidation-errorBackground);
      --error-fg: var(--vscode-errorForeground);
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--fg);
      background: var(--bg);
      height: 100vh;
      display: flex;
      flex-direction: column;
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 12px;
      border-bottom: 1px solid var(--border);
    }
    .header h2 { font-size: 14px; font-weight: 600; }
    .header-actions { display: flex; gap: 6px; }

    .toolbar {
      display: flex;
      gap: 6px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--border);
      flex-wrap: wrap;
    }
    .toolbar input {
      flex: 1;
      min-width: 120px;
      background: var(--input-bg);
      color: var(--input-fg);
      border: 1px solid var(--input-border);
      border-radius: 4px;
      padding: 6px 10px;
      font-family: inherit;
      font-size: inherit;
    }

    .models-list {
      flex: 1;
      overflow-y: auto;
      padding: 8px;
    }

    .model-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 12px;
      border-radius: 6px;
      margin-bottom: 6px;
      background: var(--vscode-editor-inactiveSelectionBackground);
      border: 1px solid var(--border);
      transition: background 0.15s;
    }
    .model-item:hover { background: var(--vscode-list-hoverBackground); }
    .model-item.current { border-color: var(--vscode-focusBorder); }

    .model-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .model-name { font-weight: 500; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .model-meta { font-size: 11px; opacity: 0.7; display: flex; gap: 12px; }
    .current-badge {
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      padding: 1px 6px;
      border-radius: 10px;
      font-size: 10px;
      font-weight: 600;
    }

    .model-actions { display: flex; gap: 6px; }
    .model-actions button {
      padding: 4px 10px;
      font-size: 11px;
      border-radius: 4px;
      cursor: pointer;
      border: none;
      font-family: inherit;
    }
    .btn-primary { background: var(--button-bg); color: var(--button-fg); }
    .btn-primary:hover { background: var(--button-hover); }
    .btn-secondary { background: var(--button2-bg); color: var(--button2-fg); }
    .btn-secondary:hover { background: var(--button2-hover); }
    .btn-danger { background: var(--vscode-inputValidation-errorBackground); color: var(--vscode-errorForeground); }
    .btn-danger:hover { opacity: 0.9; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }

    .pull-form {
      display: flex;
      gap: 8px;
      padding: 12px;
      border-top: 1px solid var(--border);
      background: var(--vscode-editor-inactiveSelectionBackground);
    }
    .pull-form input {
      flex: 1;
      background: var(--input-bg);
      color: var(--input-fg);
      border: 1px solid var(--input-border);
      border-radius: 4px;
      padding: 8px 12px;
      font-family: inherit;
      font-size: inherit;
    }

    .loading-overlay {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.5);
      display: none;
      justify-content: center;
      align-items: center;
      z-index: 100;
    }
    .loading-overlay.visible { display: flex; }
    .spinner {
      width: 32px; height: 32px;
      border: 3px solid var(--border);
      border-top-color: var(--button-bg);
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    .error-toast {
      position: fixed;
      bottom: 16px; left: 16px; right: 16px;
      background: var(--error-bg);
      color: var(--error-fg);
      padding: 12px 16px;
      border-radius: 6px;
      border: 1px solid var(--vscode-inputValidation-errorBorder);
      display: none;
      animation: slideUp 0.3s ease;
    }
    .error-toast.visible { display: block; }
    @keyframes slideUp { from { transform: translateY(100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }

    .empty-state {
      text-align: center;
      padding: 40px 20px;
      opacity: 0.6;
    }
  </style>
</head>
<body>
  <div class="header">
    <h2>🤖 Model Manager</h2>
    <div class="header-actions">
      <button id="refreshBtn" title="Atualizar lista">🔄</button>
    </div>
  </div>

  <div class="toolbar">
    <input type="text" id="searchInput" placeholder="Filtrar modelos...">
  </div>

  <div class="models-list" id="modelsList">
    <div class="empty-state">Carregando modelos...</div>
  </div>

  <div class="pull-form">
    <input type="text" id="pullInput" placeholder="Nome do modelo (ex: qwen2.5-coder:14b, llama3.1:8b)">
    <button id="pullBtn" class="btn-primary">Baixar</button>
  </div>

  <div class="loading-overlay" id="loadingOverlay">
    <div class="spinner"></div>
  </div>

  <div class="error-toast" id="errorToast"></div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const modelsList = document.getElementById('modelsList');
    const searchInput = document.getElementById('searchInput');
    const pullInput = document.getElementById('pullInput');
    const pullBtn = document.getElementById('pullBtn');
    const refreshBtn = document.getElementById('refreshBtn');
    const loadingOverlay = document.getElementById('loadingOverlay');
    const errorToast = document.getElementById('errorToast');

    let allModels = [];
    let currentModel = '';

    function showError(message) {
      errorToast.textContent = message;
      errorToast.classList.add('visible');
      setTimeout(() => errorToast.classList.remove('visible'), 5000);
    }

    function setLoading(show) {
      loadingOverlay.classList.toggle('visible', show);
    }

    function renderModels(models) {
      const filtered = models.filter(m => 
        m.toLowerCase().includes(searchInput.value.toLowerCase())
      );
      
      if (filtered.length === 0) {
        modelsList.innerHTML = '<div class="empty-state">Nenhum modelo encontrado</div>';
        return;
      }

      modelsList.innerHTML = filtered.map(model => {
        const isCurrent = model === currentModel;
        return \`
          <div class="model-item \${isCurrent ? 'current' : ''}" data-model="\${model}">
            <div class="model-info">
              <span class="model-name">\${model}\${isCurrent ? ' <span class="current-badge">Atual</span>' : ''}</span>
              <div class="model-meta">
                <span>📦 Modelo Ollama</span>
              </div>
            </div>
            <div class="model-actions">
              \${!isCurrent ? \`<button class="btn-primary select-btn" data-model="\${model}">Selecionar</button>\` : ''}
              <button class="btn-danger delete-btn" data-model="\${model}" title="Remover">🗑</button>
            </div>
          </div>
        \`;
      }).join('');
    }

    // Event listeners
    refreshBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'refresh' });
    });

    searchInput.addEventListener('input', () => {
      renderModels(allModels);
    });

    pullBtn.addEventListener('click', () => {
      const model = pullInput.value.trim();
      if (!model) {
        showError('Digite o nome do modelo');
        return;
      }
      vscode.postMessage({ type: 'pullModel', model });
      pullInput.value = '';
    });

    pullInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') pullBtn.click();
    });

    modelsList.addEventListener('click', (e) => {
      const selectBtn = e.target.closest('.select-btn');
      const deleteBtn = e.target.closest('.delete-btn');
      
      if (selectBtn) {
        vscode.postMessage({ type: 'selectModel', model: selectBtn.dataset.model });
      } else if (deleteBtn) {
        const model = deleteBtn.dataset.model;
        if (confirm(\`Remover modelo "\${model}"? Esta ação não pode ser desfeita.\`)) {
          vscode.postMessage({ type: 'deleteModel', model });
        }
      }
    });

    // Message handling
    window.addEventListener('message', (event) => {
      const data = event.data;
      
      switch (data.type) {
        case 'models':
          allModels = data.models;
          currentModel = data.currentModel;
          renderModels(allModels);
          break;
        case 'loading':
          setLoading(data.loading);
          break;
        case 'pulling':
          setLoading(data.loading);
          break;
        case 'selected':
          currentModel = data.model;
          renderModels(allModels);
          break;
        case 'error':
          showError(data.message);
          break;
      }
    });

    // Initial ready
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}

function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}