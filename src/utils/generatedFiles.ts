import * as path from 'path';

const MAX_FILES = 8;
const MAX_TOTAL_CONTENT_CHARS = 100000;

export interface GeneratedFile {
  path: string;
  language: string;
  content: string;
}

export function parseGeneratedFiles(response: string): GeneratedFile[] {
  const json = response.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  const parsed: unknown = JSON.parse(json);
  if (!parsed || typeof parsed !== 'object' || !('files' in parsed) || !Array.isArray(parsed.files)) {
    throw new Error('A resposta da IA precisa conter uma lista de arquivos.');
  }
  if (parsed.files.length === 0 || parsed.files.length > MAX_FILES) {
    throw new Error(`A resposta deve conter entre 1 e ${MAX_FILES} arquivos.`);
  }

  const seenPaths = new Set<string>();
  let totalContentChars = 0;
  const files = parsed.files.map((value: unknown): GeneratedFile => {
    if (!value || typeof value !== 'object') throw new Error('A resposta contém um arquivo inválido.');
    const file = value as Record<string, unknown>;
    if (typeof file.path !== 'string' || !file.path.trim() ||
        typeof file.content !== 'string' ||
        (file.language !== undefined && typeof file.language !== 'string')) {
      throw new Error('Cada arquivo precisa informar caminho e conteúdo válidos.');
    }

    const normalizedPath = file.path.replace(/\\/g, '/');
    const segments = normalizedPath.split('/');
    if (normalizedPath.startsWith('/') || /^[a-zA-Z]:/.test(normalizedPath) ||
        segments.some((segment) => !segment || segment === '.' || segment === '..') ||
        normalizedPath.includes('\0') || path.posix.isAbsolute(normalizedPath)) {
      throw new Error(`Caminho de arquivo inseguro: ${file.path}`);
    }

    const relativePath = segments.join('/');
    const pathKey = relativePath.toLocaleLowerCase();
    if (seenPaths.has(pathKey)) throw new Error(`Caminho duplicado: ${relativePath}`);
    seenPaths.add(pathKey);

    totalContentChars += file.content.length;
    if (totalContentChars > MAX_TOTAL_CONTENT_CHARS) {
      throw new Error('O conteúdo gerado excede o limite permitido.');
    }

    const language = typeof file.language === 'string' && file.language.trim()
      ? file.language.trim()
      : path.posix.extname(relativePath).slice(1) || 'plaintext';
    return { path: relativePath, language, content: file.content };
  });

  return files;
}