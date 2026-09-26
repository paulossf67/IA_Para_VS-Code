import * as vscode from 'vscode';
import * as path from 'path';
import { getConfig } from './ollama';

const EXCLUDE_GLOB =
  '**/{node_modules,.git,.vscode,.vscode-test,out,dist,build,coverage,.next,.nuxt,target,vendor,__pycache__,.venv,venv,bin,obj}/**';

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte',
  '.py', '.rb', '.php', '.go', '.rs', '.java', '.kt', '.swift',
  '.c', '.h', '.cpp', '.hpp', '.cs', '.scala', '.sh', '.ps1',
  '.sql', '.css', '.scss', '.html',
]);

const KEY_CONFIG_FILES = new Set([
  'package.json', 'tsconfig.json', 'pyproject.toml', 'requirements.txt',
  'go.mod', 'Cargo.toml', 'pom.xml', 'build.gradle', 'composer.json', 'Gemfile',
]);

const ENTRY_HINTS = ['index', 'main', 'app', 'extension', 'server', 'cli'];

const MAX_FILES_INCLUDED = 25;
const MAX_CHARS_PER_FILE = 6000;

export interface ContextGroup {
  id: string;
  name: string;
  tags: string[];
  files: string[];
  priority: number; // 1-10, higher = sent first to model
  includePatterns: string[];
  excludePatterns: string[];
}

export interface ContextConfig {
  groups: ContextGroup[];
  selectedGroupId: string | null;
  autoDetectGroups: boolean;
}

const STORAGE_KEY = 'local-ai.contextGroups';

function getCharBudget(): number {
  const { numCtx } = getConfig();
  return Math.max(2000, Math.floor(numCtx * 0.5 * 3.5));
}

function isTextCandidate(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return CODE_EXTENSIONS.has(ext) || KEY_CONFIG_FILES.has(path.basename(filePath));
}

async function readFileText(uri: vscode.Uri): Promise<string | null> {
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
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

function matchPatterns(filePath: string, patterns: string[]): boolean {
  return patterns.some(pattern => {
    const regex = new RegExp('^' + pattern.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') + '$');
    return regex.test(filePath) || regex.test(path.basename(filePath));
  });
}

export class AdvancedContextManager {
  constructor(private storage: vscode.Memento) {}

  async loadConfig(): Promise<ContextConfig> {
    const stored = this.storage.get<ContextConfig>(STORAGE_KEY);
    if (stored) return stored;
    return { groups: [], selectedGroupId: null, autoDetectGroups: true };
  }

  async saveConfig(config: ContextConfig): Promise<void> {
    await this.storage.update(STORAGE_KEY, config);
  }

  async createGroup(
    name: string,
    files: string[],
    tags: string[] = [],
    priority: number = 5
  ): Promise<ContextGroup> {
    const group: ContextGroup = {
      id: `group-${Date.now()}`,
      name,
      tags,
      files,
      priority,
      includePatterns: [],
      excludePatterns: [],
    };

    const config = await this.loadConfig();
    config.groups.push(group);
    await this.saveConfig(config);

    return group;
  }

  async createGroupFromFiles(
    name: string,
    fileUris: vscode.Uri[],
    tags: string[] = [],
    priority: number = 5
  ): Promise<ContextGroup> {
    const files = fileUris.map(uri => vscode.workspace.asRelativePath(uri));
    return this.createGroup(name, files, tags, priority);
  }

  async createGroupFromQuickPick(
    storage: vscode.Memento,
    name: string = 'Seleção Manual'
  ): Promise<ContextGroup | null> {
    if (!vscode.workspace.workspaceFolders) {
      vscode.window.showWarningMessage('Abra um workspace primeiro');
      return null;
    }

    const allFiles = await vscode.workspace.findFiles('**/*', EXCLUDE_GLOB, 200);
    
    const quickPicks = allFiles.map(file => ({
      label: vscode.workspace.asRelativePath(file),
      detail: file.fsPath,
      picked: false,
      uri: file,
    }));

    if (quickPicks.length === 0) {
      vscode.window.showInformationMessage('Nenhum arquivo encontrado');
      return null;
    }

    const selected = await vscode.window.showQuickPick(quickPicks, {
      canPickMany: true,
      placeHolder: `Selecione arquivos para o grupo "${name}"`,
    });

    if (!selected || selected.length === 0) return null;

    const fileUris = selected.map(item => item.uri);
    return this.createGroupFromFiles(name, fileUris, [], 10);
  }

  async updateGroup(groupId: string, updates: Partial<ContextGroup>): Promise<void> {
    const config = await this.loadConfig();
    const group = config.groups.find((g) => g.id === groupId);
    if (group) {
      Object.assign(group, updates);
      await this.saveConfig(config);
    }
  }

  async deleteGroup(groupId: string): Promise<void> {
    const config = await this.loadConfig();
    config.groups = config.groups.filter((g) => g.id !== groupId);
    if (config.selectedGroupId === groupId) {
      config.selectedGroupId = null;
    }
    await this.saveConfig(config);
  }

  async selectGroup(groupId: string | null): Promise<void> {
    const config = await this.loadConfig();
    config.selectedGroupId = groupId;
    await this.saveConfig(config);
  }

  async getSelectedGroup(): Promise<ContextGroup | null> {
    const config = await this.loadConfig();
    if (!config.selectedGroupId) return null;
    return config.groups.find((g) => g.id === config.selectedGroupId) || null;
  }

  async getContextString(): Promise<string> {
    const config = await this.loadConfig();
    const selectedGroup = await this.getSelectedGroup();

    if (!selectedGroup) {
      return ''; // No context if no group selected
    }

    if (!vscode.workspace.workspaceFolders) return '';

    const sortedGroups = config.groups.sort((a, b) => b.priority - a.priority);
    const budget = getCharBudget();

    let context = '## Contexto do Projeto (Grupos Selecionados)\n\n';
    let used = 0;

    for (const group of sortedGroups) {
      if (used >= budget) break;

      // Find files matching this group's patterns
      const uris = await vscode.workspace.findFiles(
        `{${group.includePatterns.join(',')}}`,
        EXCLUDE_GLOB,
        200
      );

      const candidates = uris
        .map(uri => ({ uri, rel: vscode.workspace.asRelativePath(uri) }))
        .filter(f => isTextCandidate(f.rel) && matchPatterns(f.rel, group.includePatterns))
        .filter(f => !group.excludePatterns.some(p => matchPatterns(f.rel, [p])));

      if (candidates.length === 0) continue;

      context += `### ${group.name} (Prioridade: ${group.priority}/10)\n`;
      if (group.tags.length > 0) {
        context += `**Tags:** ${group.tags.join(', ')}\n`;
      }
      context += '\n';

      for (const file of candidates) {
        if (used >= budget) break;

        const content = await readFileText(file.uri);
        if (!content || !content.trim()) continue;

        const remaining = budget - used;
        let slice = content.slice(0, Math.min(MAX_CHARS_PER_FILE, remaining));
        if (slice.length < content.length) {
          slice += `\n… (arquivo truncado — ${content.length} caracteres no total)`;
        }

        const block = fence(file.rel, slice);
        if (used + block.length > budget && used > 0) break;

        context += block;
        used += block.length;
      }
      context += '\n';
    }

    return context.slice(0, budget);
  }

  async autoDetectGroups(): Promise<void> {
    if (!vscode.workspace.workspaceFolders) return;

    const config = await this.loadConfig();
    config.groups = [];

    // Auto-detect common group patterns
    const commonPatterns: Array<[string, string[], string[]]> = [
      ['Backend', ['src/api/**', 'src/db/**'], ['api', 'database']],
      ['Frontend', ['src/ui/**', 'src/components/**'], ['ui', 'react']],
      ['Utils', ['src/utils/**', 'src/helpers/**'], ['utility', 'reusable']],
      ['Tests', ['**/*.test.ts', '**/*.spec.ts'], ['testing', 'qa']],
      ['Config', ['*.json', '*.config.ts'], ['configuration']],
    ];

    for (const [name, includes, tags] of commonPatterns) {
      const group: ContextGroup = {
        id: `auto-${name.toLowerCase()}`,
        name,
        tags,
        files: includes,
        priority: 5,
        includePatterns: includes,
        excludePatterns: [],
      };
      config.groups.push(group);
    }

    await this.saveConfig(config);
  }
}

export async function migrateFromContextSelector(
  storage: vscode.Memento,
  contextSelectorKey: string = 'localAI_selectedFiles'
): Promise<number> {
  const oldConfig = storage.get<{ included: string[]; excluded: string[] }>(contextSelectorKey);
  if (!oldConfig || oldConfig.included.length === 0) return 0;

  const manager = new AdvancedContextManager(storage);
  await manager.createGroupFromFiles('Migração Manual', 
    oldConfig.included.map(f => vscode.Uri.file(f)), 
    ['migrado'], 
    10
  );
  
  return oldConfig.included.length;
}

export async function showContextGroupsUI(storage: vscode.Memento): Promise<void> {
  const manager = new AdvancedContextManager(storage);
  const config = await manager.loadConfig();

  const items = [
    { label: '➕ Novo grupo (seleção manual)', description: 'Escolher arquivos manualmente', id: '__new_manual__' },
    { label: '➕ Novo grupo (padrões)', description: 'Definir com glob patterns', id: '__new_patterns__' },
    ...config.groups.map((g) => ({
      label: g.name,
      description: `${g.includePatterns.length} patterns, Priority: ${g.priority}`,
      id: g.id,
    })),
  ];

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Selecione ou crie um grupo de context',
  });

  if (!selected) return;

  if (selected.id === '__new_manual__') {
    await manager.createGroupFromQuickPick(storage);
    return;
  }

  if (selected.id === '__new_patterns__') {
    const name = await vscode.window.showInputBox({ placeHolder: 'Nome do grupo' });
    if (!name) return;
    
    const patterns = await vscode.window.showInputBox({ 
      placeHolder: 'Patterns (comma-separated, ex: src/api/**, src/db/**)' 
    });
    if (!patterns) return;

    await manager.createGroup(name, [], [], 5);
    const newConfig = await manager.loadConfig();
    const newGroup = newConfig.groups[newConfig.groups.length - 1];
    await manager.updateGroup(newGroup.id, { 
      includePatterns: patterns.split(',').map(p => p.trim()) 
    });
    return;
  }

  await manager.selectGroup(selected.id);
  vscode.window.showInformationMessage(`✅ Grupo "${selected.label}" selecionado`);
}
