import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as vscode from 'vscode';

describe('LocalAIInlineCompletionProvider', () => {
  let InlineCompletionProvider: any;
  let generateFimMock: any;
  let chatMock: any;
  let getConfigMock: any;
  let stripCodeFencesMock: any;
  let FimNotSupportedError: any;
  let SYSTEM_PROMPT: string;

  const mockDocument = {
    languageId: 'typescript',
    lineCount: 50,
    getText: vi.fn(() => 'function soma(x: number, y: number) {\n'),
    uri: vscode.Uri.file('/fake/test.ts'),
    version: 1,
    lineAt: vi.fn((line: number | { line: number }) => {
      const n = typeof line === 'number' ? line : line.line;
      return {
        lineNumber: n,
        text: '  const x = 1;',
        range: new vscode.Range(n, 0, n, 14),
        rangeIncludingLineBreak: new vscode.Range(n, 0, n, 15),
        firstNonWhitespaceCharacterIndex: 2,
        isEmptyOrWhitespace: false,
      };
    }),
  };

  const mockPosition = new vscode.Position(10, 5);

  const mockCancellationToken = {
    isCancellationRequested: false,
    onCancellationRequested: vi.fn((cb) => {
      const disposable = { dispose: vi.fn() };
      cb();
      return disposable;
    }),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    generateFimMock = vi.fn().mockResolvedValue('    return x + y;\n');
    chatMock = vi.fn().mockResolvedValue('    return x + y;\n');
    getConfigMock = vi.fn().mockReturnValue({
      url: 'http://localhost:11434',
      model: 'qwen2.5-coder:7b',
      maxTokens: 1024,
      temperature: 0.2,
      numCtx: 8192,
      maxHistoryMessages: 20,
      maxHistorySize: 10,
      enableInlineCompletion: true,
      inlineCompletionDelay: 100,
    });
    stripCodeFencesMock = vi.fn((s) => s);
    FimNotSupportedError = class extends Error {
      constructor(msg: string) { super(msg); this.name = 'FimNotSupportedError'; }
    };
    SYSTEM_PROMPT = 'Test system prompt';

    vi.doMock('../utils/ollama', () => ({
      generateFim: generateFimMock,
      chat: chatMock,
      getConfig: getConfigMock,
      stripCodeFences: stripCodeFencesMock,
      FimNotSupportedError,
      SYSTEM_PROMPT,
    }));

    ({ LocalAIInlineCompletionProvider: InlineCompletionProvider } = await import(
      './InlineCompletionProvider'
    ));
  });

  afterEach(() => {
    // clearAllMocks (e não resetAllMocks) preserva as implementações de
    // mockDocument.lineAt/getText, que são definidas uma única vez acima.
    vi.clearAllMocks();
  });

  it('retorna undefined quando autocomplete desabilitado', async () => {
    getConfigMock.mockReturnValueOnce({
      ...getConfigMock(),
      enableInlineCompletion: false,
    });

    const provider = new InlineCompletionProvider();
    const result = await provider.provideInlineCompletionItems(
      mockDocument as any,
      mockPosition,
      {} as any,
      mockCancellationToken as any
    );

    expect(result).toBeUndefined();
  });

  it('retorna undefined quando prefixo muito curto', async () => {
    mockDocument.getText.mockReturnValueOnce('  ');

    const provider = new InlineCompletionProvider();
    const result = await provider.provideInlineCompletionItems(
      mockDocument as any,
      mockPosition,
      {} as any,
      mockCancellationToken as any
    );

    expect(result).toBeUndefined();
  });

  it('usa FIM quando modelo suporta', async () => {
    mockDocument.getText
      .mockReturnValueOnce('function add(x, y) {\n') // prefix
      .mockReturnValueOnce('\n}'); // suffix

    const provider = new InlineCompletionProvider();
    const result = await provider.provideInlineCompletionItems(
      mockDocument as any,
      mockPosition,
      {} as any,
      mockCancellationToken as any
    );

    expect(generateFimMock).toHaveBeenCalled();
    expect(chatMock).not.toHaveBeenCalled();
    expect(result).toBeDefined();
    expect(result?.[0]).toBeInstanceOf(vscode.InlineCompletionItem);
  });

  it('usa chat como fallback quando FIM não suportado', async () => {
    generateFimMock.mockRejectedValueOnce(new FimNotSupportedError('not supported'));
    
    mockDocument.getText
      .mockReturnValueOnce('function add(x, y) {\n')
      .mockReturnValueOnce('\n}');

    const provider = new InlineCompletionProvider();
    const result = await provider.provideInlineCompletionItems(
      mockDocument as any,
      mockPosition,
      {} as any,
      mockCancellationToken as any
    );

    expect(generateFimMock).toHaveBeenCalled();
    expect(chatMock).toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it('cacheia modelo sem suporte FIM', async () => {
    generateFimMock.mockRejectedValueOnce(new FimNotSupportedError('not supported'));
    
    mockDocument.getText
      .mockReturnValueOnce('function add(x, y) {\n')
      .mockReturnValueOnce('\n}');

    const provider = new InlineCompletionProvider();
    
    // Primeira chamada - detecta que não suporta FIM
    await provider.provideInlineCompletionItems(
      mockDocument as any,
      mockPosition,
      {} as any,
      mockCancellationToken as any
    );

    // Segunda chamada - deve usar chat direto
    await provider.provideInlineCompletionItems(
      mockDocument as any,
      mockPosition,
      {} as any,
      mockCancellationToken as any
    );

    expect(generateFimMock).toHaveBeenCalledTimes(1);
    expect(chatMock).toHaveBeenCalledTimes(2);
  });

  it('retorna undefined quando cancelado', async () => {
    const cancelledToken = {
      ...mockCancellationToken,
      isCancellationRequested: true,
    };

    mockDocument.getText.mockReturnValueOnce('function add(x, y) {\n');

    const provider = new InlineCompletionProvider();
    const result = await provider.provideInlineCompletionItems(
      mockDocument as any,
      mockPosition,
      {} as any,
      cancelledToken as any
    );

    expect(result).toBeUndefined();
  });

  it('remove linha atual duplicada do fallback chat', async () => {
    generateFimMock.mockRejectedValueOnce(new FimNotSupportedError('not supported'));
    chatMock.mockResolvedValueOnce('  const result = x + y;\n  return result;\n');
    
    mockDocument.getText
      .mockReturnValueOnce('  const result = x + y;\n') // prefix ends with current line
      .mockReturnValueOnce('\n}');

    const provider = new InlineCompletionProvider();
    const result = await provider.provideInlineCompletionItems(
      mockDocument as any,
      mockPosition,
      {} as any,
      mockCancellationToken as any
    );

    expect(chatMock).toHaveBeenCalled();
    const completion = result?.[0]?.insertText;
    expect(completion).not.toContain('const result = x + y;'); // linha duplicada removida
  });
});

describe('Debounce behavior', () => {
  it('sleep resolves after delay', async () => {
    const { sleep } = await import('./InlineCompletionProvider');
    const start = Date.now();
    await sleep(50, { isCancellationRequested: false, onCancellationRequested: vi.fn() } as any);
    expect(Date.now() - start).toBeGreaterThanOrEqual(40);
  });

  it('sleep resolves immediately when cancelled', async () => {
    const { sleep } = await import('./InlineCompletionProvider');
    const token = {
      isCancellationRequested: true,
      onCancellationRequested: vi.fn(),
    };
    const start = Date.now();
    await sleep(50, token as any);
    expect(Date.now() - start).toBeLessThan(20);
  });
});