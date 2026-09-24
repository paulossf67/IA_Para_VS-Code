import * as vscode from 'vscode';
import * as path from 'path';
import {
  chatStream,
  checkOllamaAvailable,
  getConfig,
  trimHistory,
  OllamaMessage,
  SYSTEM_PROMPT,
} from '../utils/ollama';
import { getProjectContext } from '../utils/projectContext';
import { retryWithBackoff } from '../utils/retry';

type WebviewMessage = { type: string; [key: string]: unknown };

export class ChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = 'local-ai.chatView';

  private _view?: vscode.WebviewView;
  private webviewReady = false;
  /** Mensagens para a webview que chegaram antes dela estar pronta */
  private outbox: WebviewMessage[] = [];

  private messages: OllamaMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }];
  private abortController?: AbortController;
  /** Texto parcial da resposta em andamento (undefined = nada sendo gerado) */
  private streamingText?: string;

  /** Fila de prompts: comandos disparados durante uma resposta esperam a vez */
  private promptQueue: string[] = [];
  private isGenerating = false;

  /** Último editor de texto usado (o foco na webview não conta) */
  private lastEditor?: vscode.TextEditor;
  private disposables: vscode.Disposable[] = [];

  constructor(private readonly _extensionUri: vscode.Uri, private storage: vscode.Memento) {
    this.lastEditor = vscode.window.activeTextEditor;
    this.loadHistoryFromStorage();
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) this.lastEditor = editor;
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('local-ai.model')) {
          this.post({ type: 'model', name: getConfig().model });
        }
      })
    );
  }

  dispose() {
    this.abortController?.abort();
    this.saveHistoryToStorage();
    this.disposables.forEach((d) => d.dispose());
  }

  private saveHistoryToStorage() {
    const historyToSave = this.messages.filter((m) => m.role !== 'system');

    // Limita tamanho total em MB
    const { maxHistorySize } = getConfig();
    const maxBytes = maxHistorySize * 1024 * 1024;

    let totalSize = 0;
    let trimmedHistory: OllamaMessage[] = [];

    // Itera de trás para frente (mensagens recentes)
    for (let i = historyToSave.length - 1; i >= 0; i--) {
      const msgSize = new TextEncoder().encode(historyToSave[i].content).length;
      if (totalSize + msgSize > maxBytes) break;
      trimmedHistory.unshift(historyToSave[i]);
      totalSize += msgSize;
    }

    // Também limita a últimas 100 mensagens
    trimmedHistory = trimmedHistory.slice(-100);

    this.storage.update('chatHistory', trimmedHistory);
  }

  private loadHistoryFromStorage() {
    const saved = this.storage.get<OllamaMessage[]>('chatHistory', []);
    if (saved.length > 0) {
      this.messages = [{ role: 'system', content: SYSTEM_PROMPT }, ...saved];
    }
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;
    this.webviewReady = false;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtml(webviewView.webview);

    webviewView.onDidDispose(() => {
      this._view = undefined;
      this.webviewReady = false;
    });

    webviewView.webview.onDidReceiveMessage(async (data: WebviewMessage) => {
      switch (data.type) {
        case 'ready':
          this.onWebviewReady();
          break;
        case 'sendMessage':
          this.enqueue(String(data.text ?? ''));
          break;
        case 'clearChat':
          this.promptQueue = [];
          this.abortController?.abort();
          this.messages = [{ role: 'system', content: SYSTEM_PROMPT }];
          this.post({ type: 'cleared' });
          break;
        case 'stopGeneration':
          this.promptQueue = [];
          this.abortController?.abort();
          break;
        case 'copyCode':
          await vscode.env.clipboard.writeText(String(data.code ?? ''));
          vscode.window.setStatusBarMessage('Local AI: código copiado', 2000);
          break;
        case 'insertCode':
          await this.insertCode(String(data.code ?? ''));
          break;
        case 'selectModel':
          await vscode.commands.executeCommand('local-ai.selectModel');
          break;
      }
    });
  }

  /** Abre/foca o painel do chat */
  public async show() {
    await vscode.commands.executeCommand(`${ChatViewProvider.viewType}.focus`);
  }

  /** Usado pelos comandos (explicar, refatorar, etc.) */
  public async sendPrompt(prompt: string, title?: string) {
    await this.show();
    this.enqueue(title ? `**${title}**\n\n${prompt}` : prompt);
  }

  private onWebviewReady() {
    this.webviewReady = true;
    // Se a view foi recriada, restaura o histórico na tela
    const history = this.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }));
    this._view?.webview.postMessage({ type: 'restore', history, model: getConfig().model });

    // O histórico acima já contém as perguntas; da fila só sobram os erros
    const pendingErrors = this.outbox.filter((m) => m.type === 'error');
    this.outbox = [];
    pendingErrors.forEach((msg) => this._view?.webview.postMessage(msg));

    // Se uma resposta está sendo gerada agora, mostra o que já chegou
    if (this.streamingText !== undefined) {
      this._view?.webview.postMessage({ type: 'startAssistant' });
      if (this.streamingText) {
        this._view?.webview.postMessage({ type: 'chunk', text: this.streamingText });
      }
    }
  }

  private post(message: WebviewMessage) {
    if (this._view && this.webviewReady) {
      this._view.webview.postMessage(message);
    } else {
      this.outbox.push(message);
    }
  }

  private enqueue(text: string) {
    if (!text.trim()) return;
    this.promptQueue.push(text);
    void this.processQueue();
  }

  private async processQueue() {
    if (this.isGenerating) return;
    this.isGenerating = true;
    try {
      while (this.promptQueue.length > 0) {
        const next = this.promptQueue.shift()!;
        await this.handleUserMessage(next);
      }
    } finally {
      this.isGenerating = false;
    }
  }

  private async handleUserMessage(text: string) {
    const available = await checkOllamaAvailable();
    if (!available) {
      this.promptQueue = [];
      this.post({
        type: 'error',
        message:
          'Ollama não está rodando!\n\n1. Instale: https://ollama.com\n2. Rode no terminal: ollama serve\n3. Baixe um modelo: ollama pull qwen2.5-coder:7b',
      });
      return;
    }

    // Injeta contexto do projeto se disponível
    let enrichedText = text;
    if (vscode.workspace.workspaceFolders) {
      const context = await getProjectContext();
      if (context) {
        enrichedText = `${text}\n\n---\n### Contexto do Projeto:\n${context}`;
      }
    }

    this.messages.push({ role: 'user', content: enrichedText });
    this.post({ type: 'userMessage', text });
    this.post({ type: 'startAssistant' });

    this.abortController = new AbortController();
    let fullResponse = '';
    this.streamingText = '';

    try {
      const { maxHistoryMessages } = getConfig();
      this.messages = trimHistory(this.messages, maxHistoryMessages);

      await retryWithBackoff(
        () =>
          chatStream(
            this.messages,
            (chunk) => {
              fullResponse += chunk;
              this.streamingText = fullResponse;
              this.post({ type: 'chunk', text: chunk });
            },
            this.abortController.signal
          ),
        3,
        1000
      );

      this.messages.push({ role: 'assistant', content: fullResponse });
      this.saveHistoryToStorage();
      this.post({ type: 'endAssistant' });
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        if (fullResponse.trim()) {
          this.messages.push({ role: 'assistant', content: fullResponse });
        } else {
          this.messages.pop();
        }
        this.post({ type: 'endAssistant', stopped: true });
      } else {
        this.messages.pop();
        this.post({ type: 'error', message: err?.message || 'Erro desconhecido' });
      }
    } finally {
      this.abortController = undefined;
      this.streamingText = undefined;
    }
  }

  /** Insere o código no editor (substitui a seleção, se houver) */
  private async insertCode(code: string) {
    const editor =
      vscode.window.activeTextEditor ??
      (this.lastEditor && vscode.window.visibleTextEditors.includes(this.lastEditor)
        ? this.lastEditor
        : vscode.window.visibleTextEditors[0]);

    if (!editor) {
      vscode.window.showWarningMessage('Local AI: abra um arquivo no editor para inserir o código.');
      return;
    }

    await editor.edit((editBuilder) => {
      editBuilder.replace(editor.selection, code);
    });
    await vscode.window.showTextDocument(editor.document, editor.viewColumn);
  }

  /** Limpa o histórico após confirmação do usuário */
  public async clearHistoryWithConfirm(): Promise<void> {
    const action = await vscode.window.showWarningMessage(
      'Local AI: Tem certeza que deseja limpar todo o histórico? Essa ação não pode ser desfeita.',
      { modal: true },
      'Sim, limpar'
    );

    if (action !== 'Sim, limpar') return;

    this.messages = [{ role: 'system', content: SYSTEM_PROMPT }];
    this.storage.update('chatHistory', []);
    this.post({ type: 'cleared' });
    vscode.window.showInformationMessage('Local AI: histórico limpo.');
  }

  /** Exporta histórico em formato markdown */
  public async exportHistory(): Promise<void> {
    const userMessages = this.messages.filter((m) => m.role !== 'system');
    if (userMessages.length === 0) {
      vscode.window.showWarningMessage('Local AI: histórico vazio. Nada para exportar.');
      return;
    }

    const markdown = this.formatHistoryAsMarkdown();
    const filename = `chat-export-${new Date().toISOString().split('T')[0]}.md`;

    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(filename),
      filters: { Markdown: ['md'], JSON: ['json'], Text: ['txt'] },
    });

    if (!uri) return;

    let content = '';
    if (uri.fsPath.endsWith('.json')) {
      content = JSON.stringify(userMessages, null, 2);
    } else if (uri.fsPath.endsWith('.txt')) {
      content = this.formatHistoryAsText();
    } else {
      content = markdown;
    }

    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(content));
    vscode.window.showInformationMessage(`Local AI: histórico exportado para ${uri.fsPath}`);
  }

  private formatHistoryAsMarkdown(): string {
    const userMessages = this.messages.filter((m) => m.role !== 'system');
    let md = '# Local AI Chat History\n\n';
    md += `Exportado em: ${new Date().toLocaleString()}\n\n`;

    for (const msg of userMessages) {
      if (msg.role === 'user') {
        md += `## 💬 Você\n\n${msg.content}\n\n`;
      } else if (msg.role === 'assistant') {
        md += `## 🤖 IA\n\n${msg.content}\n\n---\n\n`;
      }
    }

    return md;
  }

  private formatHistoryAsText(): string {
    const userMessages = this.messages.filter((m) => m.role !== 'system');
    let txt = `Local AI Chat History\nExportado em: ${new Date().toLocaleString()}\n`;
    txt += '='.repeat(60) + '\n\n';

    for (const msg of userMessages) {
      if (msg.role === 'user') {
        txt += `[VOCÊ]\n${msg.content}\n\n`;
      } else if (msg.role === 'assistant') {
        txt += `[IA]\n${msg.content}\n\n${'-'.repeat(60)}\n\n`;
      }
    }

    return txt;
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
  <title>Local AI Chat</title>
  <link rel="stylesheet" href="${styleUri}">
</head>
<body>
  <div id="toolbar">
    <button id="clearBtn" title="Limpar conversa">🗑 Limpar</button>
    <button id="stopBtn" title="Parar geração" style="display:none">⏹ Parar</button>
    <button id="modelBtn" title="Trocar modelo">🤖 …</button>
  </div>

  <div id="messages"></div>

  <div id="input-area">
    <textarea id="input" placeholder="Pergunte qualquer coisa sobre código... (Shift+Enter = nova linha)" rows="1"></textarea>
    <button id="sendBtn">Enviar</button>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const messagesEl = document.getElementById('messages');
    const input = document.getElementById('input');
    const sendBtn = document.getElementById('sendBtn');
    const clearBtn = document.getElementById('clearBtn');
    const stopBtn = document.getElementById('stopBtn');
    const modelBtn = document.getElementById('modelBtn');

    const WELCOME = 'Olá! Sou seu assistente de IA local.\\nPosso ajudar a explicar código, gerar documentação, refatorar, criar testes e muito mais.\\n\\nDica: selecione código no editor e use o menu de contexto (botão direito) ou pressione **Ctrl+Shift+A** para abrir o chat.';

    let currentAssistantEl = null;
    let currentAssistantText = '';
    let renderPending = false;
    let isGenerating = false;

    // ---------- Markdown simples e seguro (tudo é escapado antes) ----------
    function escapeHtml(s) {
      return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function renderInline(text) {
      let html = escapeHtml(text);
      // código inline
      html = html.replace(/\`([^\`\\n]+)\`/g, '<code class="inline-code">$1</code>');
      // negrito
      html = html.replace(/\\*\\*([^*\\n]+)\\*\\*/g, '<strong>$1</strong>');
      // títulos (#, ##, ###)
      html = html.replace(/^(#{1,6})[ \\t]+(.+)$/gm, '<span class="md-h">$2</span>');
      return html;
    }

    function codeBlockHtml(lang, code) {
      return '<div class="code-block"><div class="code-header">' +
        '<span class="lang">' + escapeHtml(lang || 'código') + '</span>' +
        '<button data-action="copy">Copiar</button>' +
        '<button data-action="insert" title="Inserir no editor (substitui a seleção)">Inserir</button>' +
        '</div><pre><code>' + escapeHtml(code) + '</code></pre></div>';
    }

    function renderMarkdown(text) {
      // Divide pelos blocos \`\`\`; um bloco ainda aberto (streaming) também é mostrado como código
      const parts = [];
      const fence = /^[ \\t]*\`\`\`([\\w+#.-]*)[^\\n]*\\n?/gm;
      let pos = 0;
      let inCode = false;
      let lang = '';
      let m;
      while ((m = fence.exec(text)) !== null) {
        const chunk = text.slice(pos, m.index);
        if (!inCode) {
          parts.push(renderInline(chunk));
          lang = m[1];
        } else {
          parts.push(codeBlockHtml(lang, chunk.replace(/\\n$/, '')));
          lang = '';
        }
        inCode = !inCode;
        pos = m.index + m[0].length;
      }
      const rest = text.slice(pos);
      parts.push(inCode ? codeBlockHtml(lang, rest) : renderInline(rest));
      return parts.join('');
    }

    // ---------- UI ----------
    function scrollToBottom() {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function appendMessage(text, className, asMarkdown) {
      const div = document.createElement('div');
      div.className = 'message ' + className;
      if (asMarkdown) {
        div.innerHTML = renderMarkdown(text);
      } else {
        div.textContent = text;
      }
      messagesEl.appendChild(div);
      scrollToBottom();
      return div;
    }

    function showWelcome() {
      messagesEl.innerHTML = '';
      appendMessage(WELCOME, 'assistant', true);
    }

    function scheduleRender() {
      if (renderPending) return;
      renderPending = true;
      requestAnimationFrame(() => {
        renderPending = false;
        if (currentAssistantEl) {
          const nearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 60;
          currentAssistantEl.innerHTML = renderMarkdown(currentAssistantText);
          if (nearBottom) scrollToBottom();
        }
      });
    }

    function setGenerating(state) {
      isGenerating = state;
      sendBtn.disabled = state;
      stopBtn.style.display = state ? 'inline-block' : 'none';
    }

    function autoResize() {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 160) + 'px';
    }

    sendBtn.addEventListener('click', send);
    input.addEventListener('input', autoResize);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        send();
      }
    });

    clearBtn.addEventListener('click', () => vscode.postMessage({ type: 'clearChat' }));
    stopBtn.addEventListener('click', () => vscode.postMessage({ type: 'stopGeneration' }));
    modelBtn.addEventListener('click', () => vscode.postMessage({ type: 'selectModel' }));

    // Botões Copiar / Inserir dos blocos de código
    messagesEl.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const pre = btn.closest('.code-block').querySelector('pre');
      const code = pre ? pre.textContent : '';
      if (btn.dataset.action === 'copy') {
        vscode.postMessage({ type: 'copyCode', code });
        const old = btn.textContent;
        btn.textContent = 'Copiado!';
        setTimeout(() => (btn.textContent = old), 1200);
      } else if (btn.dataset.action === 'insert') {
        vscode.postMessage({ type: 'insertCode', code });
      }
    });

    function send() {
      const text = input.value.trim();
      if (!text || isGenerating) return;
      input.value = '';
      autoResize();
      vscode.postMessage({ type: 'sendMessage', text });
    }

    function setModel(name) {
      modelBtn.textContent = '🤖 ' + name;
      modelBtn.title = 'Modelo atual: ' + name + ' (clique para trocar)';
    }

    window.addEventListener('message', (event) => {
      const data = event.data;

      switch (data.type) {
        case 'restore':
          showWelcome();
          for (const m of data.history || []) {
            appendMessage(m.content, m.role === 'user' ? 'user' : 'assistant', true);
          }
          if (data.model) setModel(data.model);
          break;

        case 'model':
          setModel(data.name);
          break;

        case 'userMessage':
          appendMessage(data.text, 'user', true);
          break;

        case 'startAssistant':
          currentAssistantText = '';
          currentAssistantEl = appendMessage('', 'assistant typing', false);
          setGenerating(true);
          break;

        case 'chunk':
          if (currentAssistantEl) {
            currentAssistantText += data.text;
            scheduleRender();
          }
          break;

        case 'endAssistant':
          if (currentAssistantEl) {
            currentAssistantEl.classList.remove('typing');
            currentAssistantEl.innerHTML = renderMarkdown(currentAssistantText);
            if (data.stopped) {
              if (!currentAssistantText.trim()) currentAssistantEl.remove();
              else {
                const note = document.createElement('div');
                note.className = 'stopped-note';
                note.textContent = '(geração interrompida)';
                currentAssistantEl.appendChild(note);
              }
            }
          }
          setGenerating(false);
          currentAssistantEl = null;
          break;

        case 'error':
          if (currentAssistantEl && !currentAssistantText.trim()) currentAssistantEl.remove();
          appendMessage(data.message, 'error', false);
          setGenerating(false);
          currentAssistantEl = null;
          break;

        case 'cleared':
          setGenerating(false);
          currentAssistantEl = null;
          messagesEl.innerHTML = '';
          appendMessage('Conversa limpa. Pode começar de novo!', 'assistant', false);
          break;
      }
    });

    showWelcome();
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
