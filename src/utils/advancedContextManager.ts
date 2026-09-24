import * as vscode from 'vscode';

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

    const sortedGroups = config.groups.sort((a, b) => b.priority - a.priority);

    let context = '## Contexto do Projeto\n\n';
    for (const group of sortedGroups) {
      context += `### ${group.name}\n`;
      context += `**Tags:** ${group.tags.join(', ') || 'nenhuma'}\n`;
      context += `**Prioridade:** ${group.priority}/10\n`;
      context += `**Arquivos:** ${group.files.length}\n\n`;
    }

    return context.slice(0, 2000); // Limit to 2000 chars
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

export async function showContextGroupsUI(storage: vscode.Memento): Promise<void> {
  const manager = new AdvancedContextManager(storage);
  const config = await manager.loadConfig();

  const items = config.groups.map((g) => ({
    label: g.name,
    description: `${g.files.length} files, Priority: ${g.priority}`,
    id: g.id,
  }));

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: 'Selecione um grupo de context',
  });

  if (selected) {
    await manager.selectGroup(selected.id);
    vscode.window.showInformationMessage(`✅ Grupo "${selected.label}" selecionado`);
  }
}
