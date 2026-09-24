import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import type { SelectedFilesConfig } from './contextSelector';

const IGNORE_PATTERNS = [
  'node_modules',
  '.git',
  '.vscode',
  'dist',
  'build',
  'out',
  '.env',
  '*.lock',
];

interface CacheEntry {
  context: string;
  timestamp: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos
let contextCache: CacheEntry | null = null;

function shouldIgnore(filePath: string): boolean {
  return IGNORE_PATTERNS.some((pattern) => {
    if (pattern.includes('*')) {
      const regex = new RegExp(pattern.replace(/\./g, '\\.').replace(/\*/g, '.*'));
      return regex.test(filePath);
    }
    return filePath.includes(pattern);
  });
}

function isCacheValid(): boolean {
  if (!contextCache) return false;
  return Date.now() - contextCache.timestamp < CACHE_TTL_MS;
}

export function clearContextCache(): void {
  contextCache = null;
}

async function getWorkspaceFiles(): Promise<string[]> {
  const files: string[] = [];
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) return files;

  for (const folder of workspaceFolders) {
    const folderPath = folder.uri.fsPath;
    const allFiles = await vscode.workspace.findFiles(
      '**/*',
      '**/node_modules/**',
      50
    );

    for (const file of allFiles) {
      if (!shouldIgnore(file.fsPath)) {
        files.push(file.fsPath);
      }
    }
  }

  return files.slice(0, 30);
}

function getFileLanguage(filePath: string): string {
  const ext = path.extname(filePath);
  const extMap: { [key: string]: string } = {
    '.ts': 'TypeScript',
    '.js': 'JavaScript',
    '.tsx': 'TypeScript/React',
    '.jsx': 'JavaScript/React',
    '.py': 'Python',
    '.java': 'Java',
    '.go': 'Go',
    '.rs': 'Rust',
    '.cpp': 'C++',
    '.c': 'C',
    '.cs': 'C#',
    '.rb': 'Ruby',
    '.php': 'PHP',
    '.json': 'JSON',
    '.yaml': 'YAML',
    '.yml': 'YAML',
    '.xml': 'XML',
    '.html': 'HTML',
    '.css': 'CSS',
    '.scss': 'SCSS',
  };
  return extMap[ext] || 'Unknown';
}

async function readPackageJson(): Promise<{ name?: string; description?: string } | null> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) return null;

  for (const folder of workspaceFolders) {
    const pkgPath = path.join(folder.uri.fsPath, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const content = fs.readFileSync(pkgPath, 'utf-8');
        return JSON.parse(content);
      } catch {
        return null;
      }
    }
  }

  return null;
}

export async function getProjectContext(selectedFiles?: SelectedFilesConfig): Promise<string | null> {
  // Verifica cache antes de escanear
  if (isCacheValid() && contextCache) {
    return contextCache.context;
  }

  let files = await getWorkspaceFiles();

  // Filtra por seleção do usuário, se disponível
  if (selectedFiles && selectedFiles.included.length > 0) {
    files = files.filter((f) => {
      const rel = vscode.workspace.asRelativePath(f);
      return selectedFiles.included.includes(rel);
    });
  }
  if (files.length === 0) return null;

  const pkg = await readPackageJson();
  const languages = new Set<string>();

  for (const file of files) {
    languages.add(getFileLanguage(file));
  }

  const fileStructure = files
    .map((f) => {
      const rel = vscode.workspace.asRelativePath(f);
      return `- ${rel}`;
    })
    .join('\n');

  let context = `**Estrutura do Projeto:**\n${fileStructure}`;

  if (pkg) {
    context += `\n\n**Projeto:** ${pkg.name || 'sem nome'}`;
    if (pkg.description) {
      context += `\n**Descrição:** ${pkg.description}`;
    }
  }

  if (languages.size > 0) {
    context += `\n\n**Linguagens:** ${Array.from(languages).join(', ')}`;
  }

  const result = context.slice(0, 2000);

  // Armazena em cache
  contextCache = {
    context: result,
    timestamp: Date.now(),
  };

  return result;
}
