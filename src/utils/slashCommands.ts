import * as vscode from 'vscode';

export interface SlashCommand {
  name: string;           // sem o /, ex: "review"
  description: string;    // descrição curta
  prompt: string;         // prompt template com {selection}, {file}, {language}
  args?: string[];        // argumentos opcionais
  builtin?: boolean;
}

const STORAGE_KEY = 'local-ai.slashCommands';
const BUILTIN_COMMANDS: SlashCommand[] = [
  {
    name: 'review',
    description: 'Code review da seleção',
    prompt: 'Faça um code review completo do código abaixo. Identifique bugs, problemas de performance, segurança e estilo. Sugira melhorias concretas.\n\nCódigo:\n```{language}\n{selection}\n```',
  },
  {
    name: 'test',
    description: 'Gera testes unitários',
    prompt: 'Gere testes unitários completos para o código abaixo. Use o framework mais comum da linguagem ({language}). Inclua casos de sucesso, erro e edge cases.\n\nCódigo:\n```{language}\n{selection}\n```',
  },
  {
    name: 'docs',
    description: 'Gera documentação',
    prompt: 'Gere documentação completa (JSDoc/docstring) para o código abaixo. Inclua descrição, parâmetros, retorno, exceções e exemplos.\n\nCódigo:\n```{language}\n{selection}\n```',
  },
  {
    name: 'refactor',
    description: 'Refatora o código',
    prompt: 'Refatore o código abaixo para melhorar legibilidade, performance e boas práticas. Mantenha a mesma funcionalidade. Explique as mudanças.\n\nCódigo:\n```{language}\n{selection}\n```',
  },
  {
    name: 'explain',
    description: 'Explica o código',
    prompt: 'Explique o código abaixo de forma clara e didática. Diga o que faz, como funciona e pontos de atenção.\n\nCódigo:\n```{language}\n{selection}\n```',
  },
  {
    name: 'fix',
    description: 'Corrige bugs',
    prompt: 'Analise o código abaixo e corrija possíveis bugs, erros de lógica ou problemas de estilo. Mostre o código corrigido e explique o que estava errado.\n\nCódigo:\n```{language}\n{selection}\n```',
  },
  {
    name: 'optimize',
    description: 'Otimiza performance',
    prompt: 'Analise o código abaixo e sugira otimizações de performance. Identifique gargalos (O(n²), alocações desnecessárias, etc) e mostre versões otimizadas.\n\nCódigo:\n```{language}\n{selection}\n```',
  },
  {
    name: 'security',
    description: 'Análise de segurança',
    prompt: 'Analise o código abaixo por vulnerabilidades de segurança: SQL injection, XSS, path traversal, secrets hardcoded, etc. Sugira correções.\n\nCódigo:\n```{language}\n{selection}\n```',
  },
];

export class SlashCommandManager {
  private commands: Map<string, SlashCommand> = new Map();

  constructor(private storage: vscode.Memento) {
    this.load();
  }

  private load(): void {
    // Load built-in commands first
    for (const cmd of BUILTIN_COMMANDS) {
      this.commands.set(cmd.name, { ...cmd, builtin: true });
    }

    // Load user commands from storage
    const saved = this.storage.get<SlashCommand[]>(STORAGE_KEY, []);
    for (const cmd of saved) {
      this.commands.set(cmd.name, { ...cmd, builtin: false });
    }
  }

  getAll(): SlashCommand[] {
    return Array.from(this.commands.values());
  }

  get(name: string): SlashCommand | undefined {
    return this.commands.get(name);
  }

  getBuiltin(): SlashCommand[] {
    return BUILTIN_COMMANDS;
  }

  getUserCommands(): SlashCommand[] {
    return Array.from(this.commands.values()).filter(c => !c.builtin);
  }

  async add(command: SlashCommand): Promise<void> {
    if (this.commands.has(command.name)) {
      throw new Error(`Comando "/${command.name}" já existe`);
    }
    this.commands.set(command.name, { ...command, builtin: false });
    await this.save();
  }

  async update(name: string, updates: Partial<SlashCommand>): Promise<void> {
    const existing = this.commands.get(name);
    if (!existing) {
      throw new Error(`Comando "/${name}" não encontrado`);
    }
    if (existing.builtin) {
      throw new Error('Não é possível editar comandos built-in');
    }
    this.commands.set(name, { ...existing, ...updates, builtin: false });
    await this.save();
  }

  async delete(name: string): Promise<void> {
    const existing = this.commands.get(name);
    if (!existing) {
      throw new Error(`Comando "/${name}" não encontrado`);
    }
    if (existing.builtin) {
      throw new Error('Não é possível deletar comandos built-in');
    }
    this.commands.delete(name);
    await this.save();
  }

  private async save(): Promise<void> {
    const userCommands = this.getUserCommands();
    await this.storage.update(STORAGE_KEY, userCommands);
  }

  /**
   * Expande o template do prompt com variáveis de contexto
   */
  expandPrompt(template: string, context: {
    selection: string;
    file?: string;
    language: string;
    line?: number;
  }): string {
    return template
      .replace(/\{selection\}/g, context.selection)
      .replace(/\{language\}/g, context.language)
      .replace(/\{file\}/g, context.file || '')
      .replace(/\{line\}/g, String(context.line || ''));
  }
}

export class SlashCommandProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'local-ai.slashCommands';
  private _view?: vscode.WebviewView;
  private manager: SlashCommandManager;

  constructor(
    private extensionUri: vscode.Uri,
    private context: vscode.ExtensionContext
  ) {
    this.manager = new SlashCommandManager(context.globalState);
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

    webviewView.webview.html = this._getHtml(webviewView.webview);

    webviewView.onDidDispose(() => {
      this._view = undefined;
    });

    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case 'add':
          await this.addCommand(data.command);
          break;
        case 'edit':
          await this.editCommand(data.name, data.command);
          break;
        case 'delete':
          await this.deleteCommand(data.name);
          break;
        case 'refresh':
          this.updateView();
          break;
      }
    });

    this.updateView();
  }

  private async addCommand(cmd: SlashCommand): Promise<void> {
    try {
      await this.manager.add(cmd);
      this.updateView();
      vscode.window.showInformationMessage(`Comando "/${cmd.name}" criado!`);
    } catch (err: any) {
      vscode.window.showErrorMessage(err.message);
    }
  }

  private async editCommand(name: string, cmd: Partial<SlashCommand>): Promise<void> {
    try {
      await this.manager.update(name, cmd);
      this.updateView();
      vscode.window.showInformationMessage(`Comando "/${name}" atualizado!`);
    } catch (err: any) {
      vscode.window.showErrorMessage(err.message);
    }
  }

  private async deleteCommand(name: string): Promise<void> {
    try {
      await this.manager.delete(name);
      this.updateView();
      vscode.window.showInformationMessage(`Comando "/${name}" removido!`);
    } catch (err: any) {
      vscode.window.showErrorMessage(err.message);
    }
  }

  private updateView(): void {
    if (!this._view) return;
    this._view.webview.postMessage({
      type: 'commands',
      commands: this.manager.getAll(),
      builtinNames: this.manager.getBuiltin().map(c => c.name),
    });
  }

  private _getHtml(webview: vscode.Webview): string {
    return /*html*/ `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'unsafe-inline';">
  <title>Slash Commands</title>
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
      --input-border: var(--vscode-input-border);
      --border: var(--vscode-panel-border);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--fg); background: var(--bg); height: 100vh; display: flex; flex-direction: column; }
    .header { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border-bottom: 1px solid var(--border); }
    .header h2 { font-size: 14px; }
    .toolbar { display: flex; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--border); }
    .btn { background: var(--button-bg); color: var(--button-fg); border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; }
    .btn:hover { background: var(--button-hover); }
    .btn.secondary { background: var(--button2-bg); color: var(--button2-fg); }
    .btn.secondary:hover { background: var(--button2-hover); }
    .commands-list { flex: 1; overflow-y: auto; padding: 8px; }
    .command-item { background: var(--vscode-editor-inactiveSelectionBackground); border: 1px solid var(--border); border-radius: 6px; padding: 12px; margin-bottom: 8px; }
    .cmd-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .cmd-name { font-weight: 600; font-size: 13px; }
    .cmd-badge { font-size: 10px; padding: 1px 6px; border-radius: 10px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
    .cmd-desc { font-size: 12px; opacity: 0.8; margin-bottom: 8px; }
    .cmd-prompt { font-family: var(--vscode-editor-font-family); font-size: 11px; background: var(--input-bg); padding: 8px; border-radius: 4px; border: 1px solid var(--border); white-space: pre-wrap; max-height: 100px; overflow-y: auto; }
    .cmd-actions { display: flex; gap: 6px; margin-top: 8px; }
    .cmd-actions button { padding: 4px 10px; font-size: 11px; border-radius: 4px; border: none; cursor: pointer; font-family: inherit; }
    .btn-small { padding: 4px 10px; font-size: 11px; }
    .form-section { padding: 12px; border-top: 1px solid var(--border); background: var(--vscode-editor-inactiveSelectionBackground); }
    .form-group { margin-bottom: 12px; }
    .form-group label { display: block; font-size: 12px; margin-bottom: 4px; }
    .form-group input, .form-group textarea { width: 100%; background: var(--input-bg); color: var(--input-fg); border: 1px solid var(--input-border); border-radius: 4px; padding: 8px; font-family: inherit; font-size: 12px; }
    .form-row { display: flex; gap: 8px; }
    .form-row > * { flex: 1; }
    .builtin-tag { font-size: 10px; background: var(--vscode-charts-blue); color: white; padding: 1px 4px; border-radius: 3px; margin-left: 6px; }
  </style>
</head>
<body>
  <div class="header">
    <h2>⚡ Slash Commands</h2>
    <button class="btn" id="addBtn">➕ Novo Comando</button>
  </div>
  <div class="commands-list" id="commandsList"></div>
  <div class="form-section" id="formSection" style="display:none">
    <h3 id="formTitle">Novo Comando</h3>
    <div class="form-group">
      <label>Nome (sem /)</label>
      <input type="text" id="cmdName" placeholder="ex: meucomando">
    </div>
    <div class="form-group">
      <label>Descrição</label>
      <input type="text" id="cmdDesc" placeholder="Descrição curta">
    </div>
    <div class="form-group">
      <label>Prompt Template (use {selection}, {language}, {file}, {line})</label>
      <textarea id="cmdPrompt" rows="5"></textarea>
    </div>
    <div class="form-row">
      <button class="btn" id="saveBtn">Salvar</button>
      <button class="btn secondary" id="cancelBtn">Cancelar</button>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const list = document.getElementById('commandsList');
    const formSection = document.getElementById('formSection');
    const formTitle = document.getElementById('formTitle');
    const addBtn = document.getElementById('addBtn');
    const cancelBtn = document.getElementById('cancelBtn');
    const saveBtn = document.getElementById('saveBtn');
    const nameInput = document.getElementById('cmdName');
    const descInput = document.getElementById('cmdDesc');
    const promptInput = document.getElementById('cmdPrompt');
    let editingName = null;

    let allCommands = [];
    let builtinNames = [];

    function render() {
      if (allCommands.length === 0) {
        list.innerHTML = '<div style="padding:20px;text-align:center;opacity:0.6">Nenhum comando</div>';
        return;
      }
      list.innerHTML = allCommands.map(cmd => \`
        <div class="command-item" data-name="\${cmd.name}">
          <div class="cmd-header">
            <span class="cmd-name">/\${cmd.name}\${cmd.builtin ? ' <span class="builtin-tag">builtin</span>' : ''}</span>
            <div>
              \${!cmd.builtin ? \`
                <button class="btn-small" onclick="editCommand('\${cmd.name}')">✏️ Editar</button>
                <button class="btn-small" style="background:var(--vscode-inputValidation-errorBackground);color:var(--vscode-errorForeground)" onclick="deleteCommand('\${cmd.name}')">🗑 Excluir</button>
              \` : ''}
            </div>
          </div>
          <div class="cmd-desc">\${cmd.description}</div>
          <div class="cmd-prompt">\${escapeHtml(cmd.prompt)}</div>
        </div>
      \`).join('');
    }

    function escapeHtml(s) {
      return s.replace(/&/g,'&').replace(/</g,'<').replace(/>/g,'>').replace(/"/g,'"').replace(/'/g,''');
    }

    function showForm(cmd = null) {
      editingName = cmd?.name || null;
      formTitle.textContent = cmd ? 'Editar Comando' : 'Novo Comando';
      nameInput.value = cmd?.name || '';
      descInput.value = cmd?.description || '';
      promptInput.value = cmd?.prompt || '';
      nameInput.disabled = !!cmd?.builtin;
      if (cmd?.builtin) {
        nameInput.style.opacity = '0.5';
        nameInput.title = 'Comandos built-in não podem ter nome alterado';
      }
      formSection.style.display = 'block';
      formSection.scrollIntoView({ behavior: 'smooth' });
    }

    function hideForm() {
      formSection.style.display = 'none';
      editingName = null;
      nameInput.value = '';
      descInput.value = '';
      promptInput.value = '';
    }

    addBtn.addEventListener('click', () => showForm());
    cancelBtn.addEventListener('click', hideForm);
    
    saveBtn.addEventListener('click', async () => {
      const name = nameInput.value.trim();
      const description = descInput.value.trim();
      const prompt = promptInput.value.trim();
      if (!name || !prompt) {
        alert('Nome e prompt são obrigatórios');
        return;
      }
      if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name)) {
        alert('Nome deve começar com letra e conter apenas letras, números, _ ou -');
        return;
      }
      try {
        if (editingName) {
          await vscode.postMessage({ type: 'edit', name: editingName, command: { description, prompt } });
        } else {
          await vscode.postMessage({ type: 'add', command: { name, description, prompt } });
        }
        hideForm();
      } catch (err) {
        alert(err.message);
      }
    });

    window.addEventListener('message', (event) => {
      const data = event.data;
      if (data.type === 'commands') {
        allCommands = data.commands;
        builtinNames = data.builtinNames || [];
        render();
      }
    });

    function editCommand(name) {
      const cmd = allCommands.find(c => c.name === name);
      if (cmd) showForm(cmd);
    }

    async function deleteCommand(name) {
      if (!confirm(\`Excluir comando "/\${name}"?\`)) return;
      await vscode.postMessage({ type: 'delete', name });
    }

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}

export function createSlashCommandCommands(context: vscode.ExtensionContext, manager: SlashCommandManager): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('local-ai.slashCommands', async () => {
      await vscode.commands.executeCommand('local-ai.slashCommands.focus');
    })
  );

  // Register all slash commands dynamically
  for (const cmd of BUILTIN_COMMANDS) {
    context.subscriptions.push(
      vscode.commands.registerCommand(`local-ai.slash.${cmd.name}`, async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showWarningMessage('Abra um arquivo para usar este comando');
          return;
        }
        const selection = editor.document.getText(editor.selection);
        if (!selection.trim()) {
          vscode.window.showWarningMessage('Selecione código para usar o comando');
          return;
        }
        const expanded = new SlashCommandManager(context.globalState).expandPrompt(cmd.prompt, {
          selection,
          file: editor.document.fileName,
          language: editor.document.languageId,
          line: editor.selection.start.line + 1,
        });
        await vscode.commands.executeCommand('local-ai.openChat');
        const chatProvider = (globalThis as any).__localAIChatProvider;
        if (chatProvider) {
          chatProvider.sendPrompt(expanded, cmd.description);
        }
      })
    );
  }

  // Register user commands
  for (const cmd of manager.getUserCommands()) {
    context.subscriptions.push(
      vscode.commands.registerCommand(`local-ai.slash.${cmd.name}`, async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        const selection = editor.document.getText(editor.selection);
        if (!selection.trim()) return;
        const expanded = new SlashCommandManager(context.globalState).expandPrompt(cmd.prompt, {
          selection,
          file: editor.document.fileName,
          language: editor.document.languageId,
          line: editor.selection.start.line + 1,
        });
        await vscode.commands.executeCommand('local-ai.openChat');
        const chatProvider = (globalThis as any).__localAIChatProvider;
        if (chatProvider) {
          chatProvider.sendPrompt(expanded, cmd.description);
        }
      })
    );
  }
}