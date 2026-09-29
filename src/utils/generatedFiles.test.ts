import { describe, expect, it } from 'vitest';
import { parseGeneratedFiles } from './generatedFiles';

describe('parseGeneratedFiles', () => {
  it('parses fenced JSON and normalizes safe relative paths', () => {
    const result = parseGeneratedFiles('```json\n{"files":[{"path":"src\\\\new.ts","content":"export {};"}]}\n```');

    expect(result).toEqual([{ path: 'src/new.ts', language: 'ts', content: 'export {};' }]);
  });

  it.each(['../outside.ts', '/absolute.ts', 'C:\\outside.ts', 'src/../outside.ts'])
    ('rejects unsafe path %s', (filePath) => {
      const response = JSON.stringify({ files: [{ path: filePath, content: 'code' }] });
      expect(() => parseGeneratedFiles(response)).toThrow(/Caminho de arquivo inseguro/);
    });

  it('rejects duplicate paths and excessive file counts', () => {
    const duplicate = JSON.stringify({
      files: [
        { path: 'src/a.ts', content: 'a' },
        { path: 'src/A.ts', content: 'b' },
      ],
    });
    const tooMany = JSON.stringify({ files: Array.from({ length: 9 }, (_, index) => ({
      path: `src/file${index}.ts`, content: '',
    })) });

    expect(() => parseGeneratedFiles(duplicate)).toThrow(/Caminho duplicado/);
    expect(() => parseGeneratedFiles(tooMany)).toThrow(/entre 1 e 8/);
  });
});