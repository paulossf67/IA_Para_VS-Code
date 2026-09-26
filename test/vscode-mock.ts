// O módulo 'vscode' só existe dentro do editor. Fora dele (vitest) qualquer
// import de código que toque a API precisa deste stub, senão o arquivo de teste
// inteiro falha ao carregar.
export const workspace = {
  getConfiguration: () => ({
    get: <T>(_key: string, defaultValue?: T) => defaultValue,
    update: async () => undefined,
  }),
  workspaceFolders: undefined as unknown[] | undefined,
  findFiles: async () => [],
  fs: { readFile: async () => new Uint8Array() },
  onDidSaveTextDocument: () => ({ dispose() {} }),
  onDidChangeConfiguration: () => ({ dispose() {} }),
  onDidChangeTextDocument: () => ({ dispose() {} }),
  onDidCloseTextDocument: () => ({ dispose() {} }),
  openTextDocument: async () => ({ getText: () => '', uri: { fsPath: '' } }),
  asRelativePath: (p: unknown) => String((p as { fsPath?: string })?.fsPath ?? p),
};

export const window = {
  showInformationMessage: async () => undefined,
  showWarningMessage: async () => undefined,
  showErrorMessage: async () => undefined,
  showQuickPick: async () => undefined,
  showInputBox: async () => undefined,
  createWebviewPanel: () => ({ webview: { html: '' } }),
  withProgress: async <T>(_opts: unknown, task: (...a: never[]) => Promise<T>) =>
    task(...([{ report() {} }, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) }] as never[])),
  activeTextEditor: undefined,
  onDidChangeActiveTextEditor: () => ({ dispose() {} }),
  registerWebviewViewProvider: () => ({ dispose() {} }),
  showTextDocument: async () => undefined,
  createOutputChannel: () => ({ appendLine() {}, show() {}, dispose() {} }),
};

export const commands = {
  registerCommand: () => ({ dispose() {} }),
  executeCommand: async () => undefined,
};

export const languages = {
  createDiagnosticCollection: () => ({ set() {}, dispose() {} }),
  registerInlineCompletionItemProvider: () => ({ dispose() {} }),
};

export const env = { openExternal: async () => true };

export class Uri {
  static file = (p: string) => ({ fsPath: p });
  static parse = (p: string) => ({ toString: () => p });
  static joinPath = (...parts: unknown[]) => ({ fsPath: parts.join('/') });
}

export class Position {
  constructor(
    public line: number,
    public character: number
  ) {}
  translate(lineDelta = 0, charDelta = 0) {
    return new Position(this.line + lineDelta, this.character + charDelta);
  }
  with(line = this.line, character = this.character) {
    return new Position(line, character);
  }
}

export class Range {
  constructor(
    public startLine: number,
    public startChar: number,
    public endLine: number,
    public endChar: number
  ) {}
}

export class InlineCompletionItem {
  constructor(
    public insertText: string,
    public range?: unknown
  ) {}
}

export class InlineCompletionList {
  constructor(public items: unknown[]) {}
}

export class CancellationTokenSource {
  token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
  cancel() {
    this.token.isCancellationRequested = true;
  }
  dispose() {}
}

export class EventEmitter<T = unknown> {
  event = (_listener: (e: T) => void) => ({ dispose() {} });
  fire(_data?: T) {}
  dispose() {}
}

export class Diagnostic {
  constructor(
    public range: unknown,
    public message: string,
    public severity?: number
  ) {}
}

export const DiagnosticSeverity = { Error: 0, Warning: 1, Information: 2, Hint: 3 };
export const ConfigurationTarget = { Global: 1, Workspace: 2, WorkspaceFolder: 3 };
export const ProgressLocation = { Notification: 15 };
export const ViewColumn = { One: 1, Two: 2 };
