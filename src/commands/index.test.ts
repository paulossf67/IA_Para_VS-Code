import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getSelectedCode, extractCodeBlock } from './index';
import * as vscode from 'vscode';

describe('commands', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('getSelectedCode', () => {
    it('should return null when no editor is open', () => {
      const editorSpy = vi.spyOn(vscode.window, 'activeTextEditor', 'get').mockReturnValue(undefined);
      const warnSpy = vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(undefined);

      const result = getSelectedCode();

      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Nenhum editor ativo'));

      editorSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it('should return selected code when text is selected', () => {
      const mockEditor = {
        document: {
          getText: vi.fn().mockReturnValue('const x = 1;'),
          languageId: 'typescript',
        },
        selection: {
          isEmpty: false,
          start: new vscode.Position(0, 0),
          end: new vscode.Position(0, 12),
        },
      } as any;

      const editorSpy = vi.spyOn(vscode.window, 'activeTextEditor', 'get').mockReturnValue(mockEditor);

      const result = getSelectedCode();

      expect(result).not.toBeNull();
      expect(result?.language).toBe('typescript');
      expect(mockEditor.document.getText).toHaveBeenCalledWith(mockEditor.selection);

      editorSpy.mockRestore();
    });

    it('should return full document text when nothing is selected', () => {
      const mockEditor = {
        document: {
          getText: vi.fn().mockReturnValue('const x = 1;'),
          languageId: 'javascript',
        },
        selection: {
          isEmpty: true,
        },
      } as any;

      const editorSpy = vi.spyOn(vscode.window, 'activeTextEditor', 'get').mockReturnValue(mockEditor);

      const result = getSelectedCode();

      expect(result?.code).toBe('const x = 1;');
      expect(result?.language).toBe('javascript');
      expect(mockEditor.document.getText).toHaveBeenCalledWith();

      editorSpy.mockRestore();
    });

    it('should return null when code is empty or whitespace only', () => {
      const mockEditor = {
        document: {
          getText: vi.fn().mockReturnValue('   \n\n  '),
          languageId: 'python',
        },
        selection: {
          isEmpty: true,
        },
      } as any;

      const editorSpy = vi.spyOn(vscode.window, 'activeTextEditor', 'get').mockReturnValue(mockEditor);
      const warnSpy = vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(undefined);

      const result = getSelectedCode();

      expect(result).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Não há código'));

      editorSpy.mockRestore();
      warnSpy.mockRestore();
    });
  });

  describe('extractCodeBlock', () => {
    it('should extract code from single code block', () => {
      const response = `
Here's the solution:

\`\`\`typescript
const x = 1;
const y = 2;
\`\`\`

That's it!`;

      const code = extractCodeBlock(response);

      expect(code).toBe('const x = 1;\nconst y = 2;');
    });

    it('should handle code block with language specifier', () => {
      const response = `\`\`\`python
def hello():
    print("world")
\`\`\``;

      const code = extractCodeBlock(response);

      expect(code).toBe('def hello():\n    print("world")');
    });

    it('should return null when multiple code blocks exist', () => {
      const response = `
\`\`\`typescript
const x = 1;
\`\`\`

\`\`\`typescript
const y = 2;
\`\`\``;

      const code = extractCodeBlock(response);

      expect(code).toBeNull();
    });

    it('should return null when no code blocks exist', () => {
      const response = 'Just some text without any code blocks.';

      const code = extractCodeBlock(response);

      expect(code).toBeNull();
    });

    it('should handle code block with CRLF line endings', () => {
      const response = '```typescript\r\nconst x = 1;\r\n```';

      const code = extractCodeBlock(response);

      expect(code).toBe('const x = 1;');
    });

    it('should trim trailing newlines from code block', () => {
      const response = '```js\ncode here\n\n\n```';

      const code = extractCodeBlock(response);

      expect(code).toBe('code here');
    });

    it('should return null when code block is empty', () => {
      const response = '```typescript\n\n```';

      const code = extractCodeBlock(response);

      expect(code).toBeNull();
    });
  });
});
