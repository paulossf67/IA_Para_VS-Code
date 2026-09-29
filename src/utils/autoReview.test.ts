import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  chat: vi.fn(),
  getConfig: vi.fn(() => ({ numCtx: 8192 })),
  diagnosticSet: vi.fn(),
  diagnosticDispose: vi.fn(),
  outputAppendLine: vi.fn(),
  outputShow: vi.fn(),
}));

vi.mock('./ollama', () => ({ chat: mocks.chat, getConfig: mocks.getConfig }));
vi.mock('vscode', () => ({
  languages: {
    createDiagnosticCollection: () => ({ set: mocks.diagnosticSet, dispose: mocks.diagnosticDispose }),
  },
  window: {
    createOutputChannel: () => ({ appendLine: mocks.outputAppendLine, show: mocks.outputShow, dispose: vi.fn() }),
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
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2 },
}));

import {
  analyzeCodeOnSave,
  createCodeChunks,
  DocumentReviewScheduler,
  parseCodeIssues,
} from './autoReview';

function createDocument(code: string, version = 1) {
  return {
    uri: { fsPath: '/workspace/sample.ts', toString: () => 'file:///workspace/sample.ts' },
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