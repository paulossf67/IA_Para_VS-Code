import * as vscode from 'vscode';
import * as path from 'path';
import type { SelectedFilesConfig } from './contextSelector';
import { getConfig } from './ollama';

/** Pastas que nunca entram no contexto (build, deps, artefatos). */
const EXCLUDE_GLOB =
  '**/{node_modules,.git,.vscode,.vscode-test,out,dist,build,coverage,.next,.nuxt,target,vendor,__pycache__,.venv,venv,bin,obj}/**';

/** Só código vira contexto — .md/.lock/imagens gastam orçamento sem ajudar. */
const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte',
  '.py', '.rb', '.php', '.go', '.rs', '.java', '.kt', '.swift',
  '.c', '.h', '.cpp', '.hpp', '.cs', '.scala', '.sh', '.ps1',
  '.sql', '.css', '.scss', '.html',
]);

/** Configs pequenas que dizem muito sobre o projeto. */
const KEY_CONFIG_FILES = new Set([
  'package.json', 'tsconfig.json', 'pyproject.toml', 'requirements.txt',
  'go.mod', 'Cargo.toml', 'pom.xml', 'build.gradle', 'composer.json', 'Gemfile',
]);

/** Nomes que costumam ser o ponto de entrada. */
const ENTRY_HINTS = ['index', 'main', 'app', 'extension', 'server', 'cli'];

const MAX_FILES_SCANNED = 2000;
const MAX_CHARS_PER_FILE = 6000;
const MAX_FILES_INCLUDED = 25;

export interface ProjectContext {
  /** Bloco pronto para anexar ao prompt. */
  text: string;
  /** Caminhos relativos realmente enviados ao modelo. */
  includedFiles: string[];
  /** Arquivos que couberam só como nome, sem conteúdo. */
  listedOnly: number;
  totalChars: number;
}

interface CacheEntry {
  key: string;
  value: ProjectContext;
  timestamp: number;
}

const CACHE_TTL_MS = 60 * 1000;
let cache: CacheEntry | null = null;

export function clearContextCache(): void {
  cache = null;
}

/**
 * Orçamento de caracteres para o contexto, derivado do numCtx do modelo.
 * Metade da janela fica para histórico da conversa e para a resposta.
 * ~3.5 chars por token é uma estimativa conservadora para código.
 */
function getCharBudget(): number {
  const { numCtx } = getConfig();
  return Math.max(2000, Math.floor(numCtx * 0.5 * 3.5));
}

function isTextCandidate(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return CODE_EXTENSIONS.has(ext) || KEY_CONFIG_FILES.has(path.basename(filePath));
}

/** Maior = entra primeiro no orçamento. */
function scoreFile(relPath: string, activeFile: string | undefined, selected: Set<string>): number {
  let score = 0;

  if (activeFile && relPath === activeFile) score += 1000;
  if (selected.has(relPath)) score += 500;

  const base = path.basename(relPath, path.extname(relPath)).toLowerCase();
  if (ENTRY_HINTS.includes(base)) score += 50;
  if (KEY_CONFIG_FILES.has(path.basename(relPath))) score += 40;

  // Arquivos mais rasos na árvore costumam ser mais estruturais
  score -= relPath.split(/[\\/]/).length * 5;

  // Testes importam menos que o código que eles testam
  if (/\.(test|spec)\./.test(relPath) || /(^|[\\/])(tests?|__tests__)[\\/]/.test(relPath)) {
    score -= 60;
  }

  return score;
}

async function readFileText(uri: vscode.Uri): Promise<string | null> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    // Heurística de binário: NUL nos primeiros bytes
    const head = bytes.subarray(0, 1024);
    if (head.includes(0)) return null;
    return Buffer.from(bytes).toString('utf-8');
  } catch {
    return null;
  }
}

function fence(relPath: string, content: string): string {
  const ext = path.extname(relPath).slice(1) || 'text';
  return `#### ${relPath}\n\`\`\`${ext}\n${content}\n\`\`\`\n`;
}

/**
 * Monta o contexto do projeto com o CONTEÚDO dos arquivos (não só os nomes),
 * respeitando o orçamento de tokens do modelo.
 */
export async function getProjectContext(
  selectedFiles?: SelectedFilesConfig | null,
  activeFilePath?: string
): Promise<ProjectContext | null> {
  if (!vscode.workspace.workspaceFolders?.length) return null;

  const activeRel = activeFilePath ? vscode.workspace.asRelativePath(activeFilePath) : undefined;
  const selected = new Set(selectedFiles?.included ?? []);
  const budget = getCharBudget();

  const cacheKey = `${budget}|${activeRel ?? ''}|${[...selected].sort().join(',')}`;
  if (cache && cache.key === cacheKey && Date.now() - cache.timestamp < CACHE_TTL_MS) {
    return cache.value;
  }

  const uris = await vscode.workspace.findFiles('**/*', EXCLUDE_GLOB, MAX_FILES_SCANNED);

  let candidates = uris
    .map((uri) => ({ uri, rel: vscode.workspace.asRelativePath(uri) }))
    .filter((f) => isTextCandidate(f.rel));

  // Seleção manual do usuário restringe tudo, menos o arquivo aberto agora
  if (selected.size > 0) {
    candidates = candidates.filter((f) => selected.has(f.rel) || f.rel === activeRel);
  }

  if (candidates.length === 0) return null;

  candidates.sort(
    (a, b) => scoreFile(b.rel, activeRel, selected) - scoreFile(a.rel, activeRel, selected)
  );

  const included: string[] = [];
  const blocks: string[] = [];
  let used = 0;

  for (const file of candidates) {
    if (included.length >= MAX_FILES_INCLUDED || used >= budget) break;

    const content = await readFileText(file.uri);
    if (content === null || content.trim() === '') continue;

    const remaining = budget - used;
    let slice = content.slice(0, Math.min(MAX_CHARS_PER_FILE, remaining));
    if (slice.length < content.length) {
      slice += `\n… (arquivo truncado — ${content.length} caracteres no total)`;
    }

    const block = fence(file.rel, slice);
    if (used + block.length > budget && included.length > 0) break;

    blocks.push(block);
    included.push(file.rel);
    used += block.length;
  }

  if (included.length === 0) return null;

  const notIncluded = candidates.filter((f) => !included.includes(f.rel));
  const treeLines = notIncluded.slice(0, 40).map((f) => `- ${f.rel}`);

  let text = `### Contexto do Projeto\n\n`;
  if (activeRel && included.includes(activeRel)) {
    text += `Arquivo aberto no editor: \`${activeRel}\`\n\n`;
  }
  text += `**Conteúdo de ${included.length} arquivo(s):**\n\n${blocks.join('\n')}`;

  if (treeLines.length > 0) {
    text += `\n**Outros arquivos do projeto (conteúdo não incluído):**\n${treeLines.join('\n')}`;
    if (notIncluded.length > treeLines.length) {
      text += `\n- … e mais ${notIncluded.length - treeLines.length} arquivo(s)`;
    }
  }

  const value: ProjectContext = {
    text,
    includedFiles: included,
    listedOnly: notIncluded.length,
    totalChars: used,
  };

  cache = { key: cacheKey, value, timestamp: Date.now() };
  return value;
}
