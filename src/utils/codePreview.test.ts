import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  uriFrom: vi.fn(({ scheme, path }: { scheme: string; path: string }) => ({
    scheme,
    path,
    toString: () => `${scheme}:${path}`,
  })),
}));

vi.mock('vscode', () => ({ Uri: { from: mocks.uriFrom } }));

import { CodePreviewProvider } from './codePreview';

afterEach(() => vi.clearAllMocks());

describe('CodePreviewProvider', () => {
  it('serves and releases read-only preview content with a source extension', () => {
    const provider = new CodePreviewProvider();
    const uri = provider.createPreview('const value = 1;', 'sample.ts', 'proposed', 'typescript');

    expect(uri.path).toContain('/proposed/sample.ts');
    expect(provider.provideTextDocumentContent(uri)).toBe('const value = 1;');

    provider.release(uri);
    expect(provider.provideTextDocumentContent(uri)).toBe('');
  });

  it('uses the language id when the target has no extension', () => {
    const provider = new CodePreviewProvider();
    const uri = provider.createPreview('print("ok")', 'Untitled-1', 'original', 'python');

    expect(uri.path).toContain('/original/Untitled-1.py');
  });
});