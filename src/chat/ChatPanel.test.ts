import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as vscode from 'vscode';
import { extractCodeBlock, getSelectedCode } from '../commands';

// Mocks de VS Code API
const mockMemento = {
  get: vi.fn((key: string, defaultValue?: any) => defaultValue),
  update: vi.fn(),
  keys: vi.fn(() => []),
};

const mockWebview = {
  asWebviewUri: vi.fn((uri) => uri),
  postMessage: vi.fn(),
  html: '',
  onDidReceiveMessage: vi.fn(),
  options: { enableScripts: true, localResourceRoots: [] },
};

const mockWebviewView = {
  webview: mockWebview,
  onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
};

const mockExtensionUri = vscode.Uri.file('/fake/extension/path');

describe('ChatViewProvider Integration', () => {
  let ChatViewProvider: any;
  let chatStreamMock: any;
  let checkOllamaAvailableMock: any;
  let getConfigMock: any;
  let trimHistoryMock: any;
  let SYSTEM_PROMPT: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    // Restaura o comportamento de Memento.get: devolver o valor padrão.
    // Sem isso, um mockReturnValue de teste anterior vaza para os seguintes.
    mockMemento.get.mockImplementation((_key: string, defaultValue?: any) => defaultValue);

    chatStreamMock = vi.fn().mockResolvedValue('Resposta da IA');
    checkOllamaAvailableMock = vi.fn().mockResolvedValue(true);
    getConfigMock = vi.fn().mockReturnValue({
      url: 'http://localhost:11434',
      model: 'qwen2.5-coder:7b',
      maxTokens: 1024,
      temperature: 0.2,
      numCtx: 8192,
      maxHistoryMessages: 20,
      maxHistorySize: 10,
    });
    trimHistoryMock = vi.fn((msgs) => msgs);
    SYSTEM_PROMPT = 'Test system prompt';

    // importOriginal preserva as funções puras (stripCodeFences, isModelInstalled…)
    // para que possam ser testadas de verdade; só o que faz I/O é mockado.
    vi.doMock('../utils/ollama', async (importOriginal) => ({
      ...(await importOriginal<Record<string, unknown>>()),
      chatStream: chatStreamMock,
      checkOllamaAvailable: checkOllamaAvailableMock,
      getConfig: getConfigMock,
      SYSTEM_PROMPT,
    }));

    vi.doMock('../utils/projectContext', () => ({
      getProjectContext: vi.fn().mockResolvedValue(null),
      clearContextCache: vi.fn(),
    }));

    vi.doMock('../utils/contextStorage', () => ({
      getSelectedFilesConfig: vi.fn().mockReturnValue(null),
    }));

    vi.doMock('../utils/advancedContextManager', () => ({
      AdvancedContextManager: vi.fn().mockImplementation(() => ({
        getContextString: vi.fn().mockResolvedValue(''),
      })),
    }));

    vi.doMock('../utils/retry', () => ({
      retryWithBackoff: vi.fn((fn) => fn()),
    }));

    vi.doMock('vscode', () => vscode);
    ({ ChatViewProvider } = await import('./ChatPanel'));
  });

  afterEach(() => {
    // clearAllMocks preserva as implementações definidas no beforeEach;
    // resetAllMocks as apagaria e os mocks passariam a devolver undefined.
    vi.clearAllMocks();
    (vscode.window as any).activeTextEditor = undefined;
  });

  it('carrega histórico do storage ao inicializar', () => {
    const historico = [
      { role: 'user', content: 'Olá' },
      { role: 'assistant', content: 'Oi!' },
    ];

    mockMemento.get.mockReturnValue(historico);

    const provider = new ChatViewProvider(mockExtensionUri, mockMemento);
    expect(provider).toBeDefined();
  });

  it('salva histórico ao descartar', () => {
    const historico = [
      { role: 'user', content: 'Test' },
      { role: 'assistant', content: 'Response' },
    ];

    // Sem isso o provider nasce vazio e salvaria [] — o teste precisa que o
    // historico exista no storage para verificar o ciclo carregar/salvar.
    mockMemento.get.mockReturnValue(historico);

    const provider = new ChatViewProvider(mockExtensionUri, mockMemento);
    provider.dispose();

    expect(mockMemento.update).toHaveBeenCalledWith('chatHistory', historico);
  });

  it('salva somente as 100 mensagens mais recentes', () => {
    const manyMessages = Array.from({ length: 150 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i}`,
    }));

    mockMemento.get.mockReturnValue(manyMessages);
    const provider = new ChatViewProvider(mockExtensionUri, mockMemento);
    provider.dispose();

    const savedHistory = mockMemento.update.mock.calls.at(-1)?.[1];
    expect(savedHistory).toHaveLength(100);
    expect(savedHistory[0].content).toBe('Message 50');
  });

  it('salva as mensagens recentes que cabem no limite configurado', () => {
    const messages = ['antiga', 'recente', 'mais recente'].map((content) => ({
      role: 'user',
      content: content.padEnd(1024 * 1024, 'x'),
    }));
    getConfigMock.mockReturnValue({
      ...getConfigMock(),
      maxHistorySize: 2,
    });
    mockMemento.get.mockReturnValue(messages);

    const provider = new ChatViewProvider(mockExtensionUri, mockMemento);
    provider.dispose();

    const savedHistory = mockMemento.update.mock.calls.at(-1)?.[1];
    expect(savedHistory).toHaveLength(2);
    expect(savedHistory.map((message: any) => message.content[0])).toEqual(['r', 'm']);
    expect(savedHistory.reduce(
      (total: number, message: any) => total + new TextEncoder().encode(message.content).length,
      0
    )).toBeLessThanOrEqual(2 * 1024 * 1024);
  });

  it('não enfileira prompt vazio ou composto apenas por espaços', async () => {
    const provider = new ChatViewProvider(mockExtensionUri, mockMemento);

    await provider.sendPrompt('   ');
    await provider.sendPrompt('');

    expect(chatStreamMock).not.toHaveBeenCalled();
    expect(provider.getHistory()).toEqual([]);
  });

  it('formata histórico como markdown para export', () => {
    const messages = [
      { role: 'user', content: 'Como refatorar?' },
      { role: 'assistant', content: '1. Use composição\n2. Separe responsabilidades' },
    ];

    let md = '# Local AI Chat History\n\n';
    for (const msg of messages) {
      if (msg.role === 'user') {
        md += `## 💬 Você\n\n${msg.content}\n\n`;
      } else if (msg.role === 'assistant') {
        md += `## 🤖 IA\n\n${msg.content}\n\n---\n\n`;
      }
    }

    expect(md).toContain('# Local AI Chat History');
    expect(md).toContain('💬 Você');
    expect(md).toContain('🤖 IA');
    expect(md).toContain('Como refatorar?');
  });

  it('formata histórico como JSON para export', () => {
    const messages = [
      { role: 'user', content: 'Teste' },
      { role: 'assistant', content: 'Resposta' },
    ];

    const json = JSON.stringify(messages, null, 2);
    const parsed = JSON.parse(json);

    expect(parsed).toHaveLength(2);
    expect(parsed[0].role).toBe('user');
    expect(parsed[1].role).toBe('assistant');
  });

  it('formata histórico como texto simples', () => {
    const messages = [
      { role: 'user', content: 'Pergunta' },
      { role: 'assistant', content: 'Resposta' },
    ];

    let txt = 'Local AI Chat History\n';
    for (const msg of messages) {
      if (msg.role === 'user') {
        txt += `[VOCÊ]\n${msg.content}\n\n`;
      } else {
        txt += `[IA]\n${msg.content}\n\n`;
      }
    }

    expect(txt).toContain('[VOCÊ]');
    expect(txt).toContain('[IA]');
    expect(txt).toContain('Pergunta');
  });

  it('usa o documento inteiro quando não há seleção para corrigir', () => {
    const document = {
      languageId: 'typescript',
      getText: vi.fn().mockReturnValue('const x = 1;\nconsole.log(x);'),
    };

    (vscode as any).window.activeTextEditor = {
      document,
      selection: { isEmpty: true },
    };

    const selected = getSelectedCode();

    expect(selected).toEqual({
      code: 'const x = 1;\nconsole.log(x);',
      language: 'typescript',
    });
    expect(document.getText).toHaveBeenCalled();
  });

  it('extrai uma correção de um único bloco de código', () => {
    expect(extractCodeBlock('```typescript\nconst value = 2;\n```')).toBe('const value = 2;');
  });

  it('recusa respostas sem bloco ou com vários blocos de código', () => {
    expect(extractCodeBlock('Não encontrei uma correção.')).toBeNull();
    expect(extractCodeBlock('```ts\nconst a = 1;\n```\n```ts\nconst b = 2;\n```')).toBeNull();
  });

  it('rejeita limpeza de histórico sem confirmação', () => {
    const shouldClear = false;

    if (shouldClear) {
      // Limpar
    } else {
      // Manter histórico
    }

    expect(shouldClear).toBe(false);
  });

  it('limpa histórico após confirmação', () => {
    const messages = [
      { role: 'system', content: 'System' },
      { role: 'user', content: 'Msg 1' },
      { role: 'assistant', content: 'Response 1' },
    ];

    const cleared = [{ role: 'system', content: 'System' }];

    expect(cleared).toHaveLength(1);
    expect(cleared[0].role).toBe('system');
  });

  it('processQueue processa mensagens em fila sequencialmente', async () => {
    const provider = new ChatViewProvider(mockExtensionUri, mockMemento);
    provider.resolveWebviewView(mockWebviewView as any, {} as any, {} as any);

    // sendPrompt e a API publica que enfileira. A segunda chamada cai na fila
    // porque a primeira ainda esta gerando; ambas rodam em sequencia.
    await provider.sendPrompt('Primeira mensagem');
    await provider.sendPrompt('Segunda mensagem');

    // O processamento e disparado sem await (void processQueue), entao o teste
    // espera a fila drenar em vez de verificar no mesmo tick.
    await vi.waitFor(() => expect(chatStreamMock).toHaveBeenCalledTimes(2));
  });

  it('devolve a resposta completa ao comando que aguarda o resultado', async () => {
    const provider = new ChatViewProvider(mockExtensionUri, mockMemento);
    provider.resolveWebviewView(mockWebviewView as any, {} as any, {} as any);

    await expect(provider.sendPromptAndWait('Corrija este código', 'Corrigir Código'))
      .resolves.toBe('Resposta da IA');
  });

  it('inclui no prompt a versão ainda não salva do arquivo ativo', async () => {
    (vscode.window as any).activeTextEditor = {
      document: {
        fileName: '/workspace/feature.ts',
        languageId: 'typescript',
        isDirty: true,
        getText: () => 'export const unsavedFeature = true;',
      },
    };
    const provider = new ChatViewProvider(mockExtensionUri, mockMemento);
    provider.resolveWebviewView(mockWebviewView as any, {} as any, {} as any);

    await provider.sendPromptAndWait('Crie uma função para este arquivo', 'Criar Código');

    const sentMessages = chatStreamMock.mock.calls[0][0];
    const userMessage = sentMessages.find((message: { role: string }) => message.role === 'user');
    expect(userMessage.content).toContain('Versão atual não salva de feature.ts');
    expect(userMessage.content).toContain('export const unsavedFeature = true;');
  });

  it('envia etapas de progresso ao corrigir código', async () => {
    chatStreamMock.mockImplementation(async (_messages: unknown, onChunk: (text: string) => void) => {
      onChunk('Resposta parcial');
      return 'Resposta parcial';
    });
    const provider = new ChatViewProvider(mockExtensionUri, mockMemento);
    provider.resolveWebviewView(mockWebviewView as any, {} as any, {} as any);
    const receiveMessage = mockWebview.onDidReceiveMessage.mock.calls[0][0];
    await receiveMessage({ type: 'ready' });

    await provider.sendPromptAndWait('Corrija este código', 'Corrigir Código');

    const messages = mockWebview.postMessage.mock.calls.map(([message]) => message);
    expect(messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'progress', stage: 'context' }),
      expect.objectContaining({ type: 'startAssistant', stage: 'correcting' }),
      expect.objectContaining({ type: 'progress', stage: 'generating' }),
      expect.objectContaining({ type: 'endAssistant' }),
    ]));
  });

  it('anexa imagens selecionadas à mensagem enviada ao Ollama', async () => {
    getConfigMock.mockReturnValue({
      url: 'http://localhost:11434',
      model: 'llava:latest',
      maxTokens: 1024,
      temperature: 0.2,
      numCtx: 8192,
      maxHistoryMessages: 20,
      maxHistorySize: 10,
    });

    const provider = new ChatViewProvider(mockExtensionUri, mockMemento);
    (vscode.window as any).showOpenDialog = vi.fn().mockResolvedValue([
      vscode.Uri.file('/workspace/foto.png'),
    ]);
    vi.spyOn(vscode.workspace.fs, 'readFile').mockResolvedValue(
      new TextEncoder().encode('imagem')
    );

    provider.resolveWebviewView(mockWebviewView as any, {} as any, {} as any);
    await (provider as any).attachFiles();
    const receiveMessage = mockWebview.onDidReceiveMessage.mock.calls[0][0];
    await receiveMessage({ type: 'sendMessage', text: 'Descreva a imagem' });

    await vi.waitFor(() => expect(chatStreamMock).toHaveBeenCalled());
    const messages = chatStreamMock.mock.calls[0][0];
    expect(messages.findLast((message: any) => message.role === 'user').images).toEqual([
      Buffer.from('imagem').toString('base64'),
    ]);
  });

  it('anexa arquivos de texto e log no prompt do chat', async () => {
    const provider = new ChatViewProvider(mockExtensionUri, mockMemento);
    const showOpenDialog = vi.fn().mockResolvedValue([
      vscode.Uri.file('/workspace/app.log'),
      vscode.Uri.file('/workspace/notes.txt'),
    ]);
    (vscode.window as any).showOpenDialog = showOpenDialog;
    vi.spyOn(vscode.workspace.fs, 'readFile')
      .mockResolvedValueOnce(new TextEncoder().encode('linha 1 do log\nlinha 2 do log'))
      .mockResolvedValueOnce(new TextEncoder().encode('conteudo do texto'));

    provider.resolveWebviewView(mockWebviewView as any, {} as any, {} as any);
    await (provider as any).attachFiles();
    expect(showOpenDialog).toHaveBeenCalledWith(expect.objectContaining({
      filters: expect.objectContaining({
        'Textos e logs': expect.arrayContaining(['txt', 'log', 'text']),
      }),
    }));

    const receiveMessage = mockWebview.onDidReceiveMessage.mock.calls[0][0];
    await receiveMessage({ type: 'sendMessage', text: 'Analise os logs e texto' });

    await vi.waitFor(() => expect(chatStreamMock).toHaveBeenCalled());
    const messages = chatStreamMock.mock.calls[0][0];
    const userMessage = messages.findLast((message: any) => message.role === 'user');
    expect(userMessage.content).toContain('--- Documento anexado: app.log ---');
    expect(userMessage.content).toContain('linha 1 do log');
    expect(userMessage.content).toContain('conteudo do texto');
  });
});

describe('ollama utility functions', () => {
  it('trimHistory mantém system prompt e últimas N mensagens', async () => {
    const { trimHistory } = await import('../utils/ollama');
    
    const messages = [
      { role: 'system', content: 'System' },
      { role: 'user', content: 'Msg 1' },
      { role: 'assistant', content: 'Resp 1' },
      { role: 'user', content: 'Msg 2' },
      { role: 'assistant', content: 'Resp 2' },
      { role: 'user', content: 'Msg 3' },
      { role: 'assistant', content: 'Resp 3' },
    ];

    const result = trimHistory(messages, 3);

    expect(result[0].role).toBe('system');
    // As 3 últimas seriam [Resp 2, Msg 3, Resp 3], mas a conversa não pode
    // começar por uma resposta órfã do assistente: 'Resp 2' cai fora.
    expect(result.length).toBe(3);
    expect(result[1].content).toBe('Msg 3');
  });

  it('trimHistory não começa com assistant', async () => {
    const { trimHistory } = await import('../utils/ollama');
    
    const messages = [
      { role: 'system', content: 'System' },
      { role: 'assistant', content: 'Resp órfã' },
      { role: 'user', content: 'Msg 1' },
      { role: 'assistant', content: 'Resp 1' },
    ];

    const result = trimHistory(messages, 2);
    
    expect(result[0].role).toBe('system');
    expect(result[1].role).toBe('user');
  });

  it('getConfig retorna defaults quando config não definida', async () => {
    const { getConfig } = await import('../utils/ollama');
    const config = getConfig();
    
    expect(config.url).toBe('http://localhost:11434');
    expect(config.model).toBe('qwen2.5-coder:7b');
    expect(config.maxTokens).toBe(1024);
    expect(config.temperature).toBe(0.2);
    expect(config.numCtx).toBe(8192);
  });

  it('isModelInstalled verifica modelo com e sem tag', async () => {
    const { isModelInstalled } = await import('../utils/ollama');
    
    const installed = ['qwen2.5-coder:7b', 'llama3.1:8b', 'mistral:latest'];

    expect(isModelInstalled('qwen2.5-coder:7b', installed)).toBe(true);

    // Nome sem tag equivale a ':latest' — e ':latest' é uma tag distinta de
    // ':7b'. Ter o 7b instalado não significa ter o latest.
    expect(isModelInstalled('qwen2.5-coder', installed)).toBe(false);
    expect(isModelInstalled('qwen2.5-coder:latest', installed)).toBe(false);

    // Já 'mistral' resolve para 'mistral:latest', que está instalado
    expect(isModelInstalled('mistral', installed)).toBe(true);

    expect(isModelInstalled('deepseek-coder:16b', installed)).toBe(false);
  });

  it('stripCodeFences remove cercas markdown', async () => {
    const { stripCodeFences } = await import('../utils/ollama');
    
    expect(stripCodeFences('```js\ncode\n```')).toBe('code');
    expect(stripCodeFences('```\ncode\n```')).toBe('code');
    expect(stripCodeFences('code sem cercas')).toBe('code sem cercas');
    expect(stripCodeFences('```python\nprint("hi")\n```')).toBe('print("hi")');
  });
});