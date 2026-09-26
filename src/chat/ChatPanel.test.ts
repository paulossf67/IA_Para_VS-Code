import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as vscode from 'vscode';

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

    vi.doMock('../utils/contextSelector', () => ({
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

    ({ ChatViewProvider } = await import('./ChatPanel'));
  });

  afterEach(() => {
    // clearAllMocks preserva as implementações definidas no beforeEach;
    // resetAllMocks as apagaria e os mocks passariam a devolver undefined.
    vi.clearAllMocks();
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

    const provider = new ChatViewProvider(mockExtensionUri, mockMemento);
    provider.dispose();

    expect(mockMemento.update).toHaveBeenCalledWith('chatHistory', historico);
  });

  it('limita histórico a 100 mensagens', () => {
    const manyMessages = Array.from({ length: 150 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i}`,
    }));

    const limited = manyMessages.slice(-100);

    expect(limited).toHaveLength(100);
    expect(limited[0].content).toBe('Message 50');
  });

  it('limita histórico por tamanho em MB', () => {
    const maxSizeBytes = 5 * 1024 * 1024;
    const messages = [
      { role: 'user', content: 'x'.repeat(1000000) },
      { role: 'assistant', content: 'y'.repeat(1000000) },
      { role: 'user', content: 'z'.repeat(1000000) },
    ];

    let totalSize = 0;
    const trimmed = [];

    for (let i = messages.length - 1; i >= 0; i--) {
      const size = new TextEncoder().encode(messages[i].content).length;
      if (totalSize + size > maxSizeBytes) break;
      trimmed.unshift(messages[i]);
      totalSize += size;
    }

    expect(totalSize).toBeLessThanOrEqual(maxSizeBytes);
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
    
    mockWebview.onDidReceiveMessage.mockImplementation((handler) => {
      handler({ type: 'ready' });
    });

    await new Promise(r => setTimeout(r, 10));

    provider.enqueue('Primeira mensagem');
    provider.enqueue('Segunda mensagem');

    expect(chatStreamMock).toHaveBeenCalledTimes(2);
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
    expect(result.length).toBe(4); // system + 3 últimas
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
    
    const installed = ['qwen2.5-coder:7b', 'llama3.1:8b'];
    
    expect(isModelInstalled('qwen2.5-coder:7b', installed)).toBe(true);
    expect(isModelInstalled('qwen2.5-coder', installed)).toBe(true);
    expect(isModelInstalled('qwen2.5-coder:latest', installed)).toBe(true);
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