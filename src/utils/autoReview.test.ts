import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  chat: vi.fn(),
  getConfig: vi.fn(() => ({ numCtx: 8192 })),
  diagnosticSet: vi.fn(),
  diagnosticDispose: vi.fn(),
  outputAppendLine: vi.fn(),
  outputShow: vi.fn(),
  showInformationMessage: vi.fn(),
}));

vi.mock('./ollama', () => ({ chat: mocks.chat, getConfig: mocks.getConfig }));
vi.mock('vscode', () => ({
  languages: {
    createDiagnosticCollection: () => ({ set: mocks.diagnosticSet, dispose: mocks.diagnosticDispose }),
  },
  window: {
    createOutputChannel: () => ({ appendLine: mocks.outputAppendLine, show: mocks.outputShow, dispose: vi.fn() }),
    showInformationMessage: mocks.showInformationMessage,
    withProgress: async (_options: unknown, task: (progress: { report: () => void }) => Promise<unknown>) =>
      task({ report: vi.fn() }),
  },
  Range: class Range {
    constructor(
      public startLine: number,
      public startCharacter: number,
      public endLine: number,
      public endCharacter: number
    ) {}
  },
  Diagnostic: class Diagnostic {
    constructor(public range: unknown, public message: string, public severity: number) {}
  },
  CodeAction: class CodeAction {
    diagnostics: unknown[] = [];
    command: unknown;
    constructor(public title: string, public kind: number) {}
  },
  CodeActionKind: { QuickFix: 1 },
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2 },
  ProgressLocation: { Notification: 15 },
}));

import {
  analyzeCodeOnSave,
  CodeReviewActionProvider,
  createCodeChunks,
  DocumentReviewScheduler,
  parseCodeIssues,
} from './autoReview';

function createDocument(code: string, version = 1, filePath = '/workspace/sample.ts') {
  return {
    uri: { fsPath: filePath, toString: () => `file://${filePath}` },
    languageId: 'typescript',
    version,
    getText: () => code,
    lineAt: () => ({ text: 'const value = 1;' }),
  } as never;
}

function issue(line: number, severity = 'warning') {
  return JSON.stringify([{ line, severity, message: 'Potential issue', suggestion: 'Review this code' }]);
}

afterEach(() => {
  vi.clearAllMocks();
  mocks.getConfig.mockReturnValue({ numCtx: 8192 });
});

describe('auto review output validation', () => {
  it('accepts valid JSON and numbered lines', () => {
    const result = parseCodeIssues(issue(4), { text: '', startLine: 2, endLine: 5 }, 10);

    expect(result[0]).toMatchObject({ line: 4, severity: 'warning' });
  });

  it('rejects malformed data and lines outside the analyzed chunk', () => {
    const chunk = { text: '', startLine: 2, endLine: 5 };

    expect(() => parseCodeIssues('not json', chunk, 10)).toThrow();
    expect(() => parseCodeIssues(issue(6), chunk, 10)).toThrow(/fora do trecho/);
    expect(() => parseCodeIssues(issue(4, 'fatal'), chunk, 10)).toThrow(/severidade inválida/);
  });

  it('splits a full source file into bounded chunks with absolute line numbers', () => {
    const code = Array.from({ length: 1200 }, (_, index) => `const value${index} = ${index};`).join('\n');
    const chunks = createCodeChunks(code, 2000);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].text).toContain('1: const value0');
    expect(chunks.at(-1)?.text).toContain('1200: const value1199');
    expect(chunks.every((chunk) => chunk.text.length <= 2000)).toBe(true);
  });
});

describe('DocumentReviewScheduler', () => {
  it('debounces per document without dropping saves to another file', () => {
    vi.useFakeTimers();
    const scheduler = new DocumentReviewScheduler();
    const firstFile = vi.fn();
    const secondFile = vi.fn();

    scheduler.schedule('file:///first.ts', 100, firstFile);
    scheduler.schedule('file:///first.ts', 100, firstFile);
    scheduler.schedule('file:///second.ts', 100, secondFile);
    vi.advanceTimersByTime(100);

    expect(firstFile).toHaveBeenCalledTimes(1);
    expect(secondFile).toHaveBeenCalledTimes(1);
    scheduler.dispose();
    vi.useRealTimers();
  });

  it('cancels pending reviews when disposed', () => {
    vi.useFakeTimers();
    const scheduler = new DocumentReviewScheduler();
    const callback = vi.fn();

    scheduler.schedule('file:///sample.ts', 100, callback);
    scheduler.dispose();
    vi.advanceTimersByTime(100);

    expect(callback).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe('analyzeCodeOnSave', () => {
  it('informa quando não encontra problemas no código', async () => {
    mocks.chat.mockResolvedValueOnce('[]');

    await analyzeCodeOnSave(createDocument('const value = 1;'));

    expect(mocks.diagnosticSet.mock.calls[0][1]).toEqual([]);
    expect(mocks.showInformationMessage).toHaveBeenCalledWith(
      'Local AI: nenhum problema encontrado; o código parece correto.'
    );
  });

  it('evita repetir avisos automáticos para o mesmo arquivo dentro do intervalo', async () => {
    vi.useFakeTimers();
    mocks.chat.mockResolvedValue('[]');
    const document = createDocument('const value = 1;', 1, '/workspace/cooldown.ts');

    await analyzeCodeOnSave(document);
    await analyzeCodeOnSave(document);

    expect(mocks.showInformationMessage).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('sempre informa o resultado limpo quando a revisão é manual', async () => {
    vi.useFakeTimers();
    mocks.chat.mockResolvedValue('[]');
    const document = createDocument('const value = 1;', 1, '/workspace/manual-clean.ts');

    await analyzeCodeOnSave(document);
    await analyzeCodeOnSave(document, { manual: true });

    expect(mocks.showInformationMessage).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('shows AI suggestions in diagnostics and exposes a quick fix', async () => {
    mocks.chat.mockResolvedValueOnce(issue(1));

    await analyzeCodeOnSave(createDocument('const value = 1;'));

    const [diagnostic] = mocks.diagnosticSet.mock.calls[0][1];
    expect(diagnostic.message).toContain('Sugestão: Review this code');
    expect(diagnostic.source).toBe('Local AI Review');
    expect(diagnostic.code).toBe('Review this code');

    const [action] = new CodeReviewActionProvider().provideCodeActions(
      createDocument('const value = 1;'),
      {} as never,
      { diagnostics: [diagnostic] } as never
    );
    expect(action.title).toBe('Corrigir com Local AI');
    expect(action.command).toMatchObject({
      command: 'local-ai.fixDiagnostic',
      arguments: [diagnostic.range, diagnostic.message, 'Review this code'],
    });
  });

  it('logs failures instead of reporting an empty successful review', async () => {
    mocks.chat.mockRejectedValueOnce(new Error('Ollama indisponível'));

    await analyzeCodeOnSave(createDocument('const value = 1;'));

    expect(mocks.outputAppendLine).toHaveBeenCalledWith(expect.stringContaining('Ollama indisponível'));
    expect(mocks.diagnosticSet).not.toHaveBeenCalled();
  });

  it('ignores the result of an older analysis when a newer one finishes first', async () => {
    let resolveFirst!: (value: string) => void;
    let resolveSecond!: (value: string) => void;
    mocks.chat
      .mockImplementationOnce(() => new Promise<string>((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise<string>((resolve) => { resolveSecond = resolve; }));
    const document = createDocument('const value = 1;');

    const firstAnalysis = analyzeCodeOnSave(document);
    const secondAnalysis = analyzeCodeOnSave(document);
    resolveSecond(issue(1));
    await secondAnalysis;
    resolveFirst('[]');
    await firstAnalysis;

    expect(mocks.diagnosticSet).toHaveBeenCalledTimes(1);
    expect(mocks.diagnosticSet.mock.calls[0][1]).toHaveLength(1);
  });
});