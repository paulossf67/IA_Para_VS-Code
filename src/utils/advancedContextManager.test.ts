import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { AdvancedContextManager, ContextConfig } from './advancedContextManager';

const workspaceFiles = [
  { fsPath: '/workspace/docs/guide.md' },
  { fsPath: '/workspace/src/nested/module.ts' },
];

function createStorage(group: ContextConfig['groups'][number]) {
  const config: ContextConfig = {
    groups: [group],
    selectedGroupId: group.id,
    autoDetectGroups: false,
  };

  return {
    get: vi.fn((_key: string, defaultValue?: unknown) => config ?? defaultValue),
    update: vi.fn(),
  } as unknown as vscode.Memento;
}

function createEmptyStorage() {
  let config: ContextConfig | undefined;
  const storage = {
    get: vi.fn((_key: string, defaultValue?: unknown) => config ?? defaultValue),
    update: vi.fn(async (_key: string, value: unknown) => {
      config = value as ContextConfig;
    }),
  };

  return { storage: storage as unknown as vscode.Memento, read: () => config };
}

function createGroup(files: string[], includePatterns: string[] = []): ContextConfig['groups'][number] {
  return {
    id: 'selected',
    name: 'Seleção',
    tags: [],
    files,
    priority: 10,
    includePatterns,
    excludePatterns: [],
  };
}

beforeEach(() => {
  vscode.workspace.workspaceFolders = [{ uri: { fsPath: '/workspace' } }] as any;
});

afterEach(() => {
  vi.restoreAllMocks();
  vscode.workspace.workspaceFolders = undefined;
});

describe('AdvancedContextManager context selection', () => {
  it('includes explicitly selected Markdown files', async () => {
    vi.spyOn(vscode.workspace, 'asRelativePath').mockImplementation((uri: any) =>
      uri.fsPath.replace('/workspace/', '')
    );
    vi.spyOn(vscode.workspace, 'findFiles').mockResolvedValue(workspaceFiles as any);
    vi.spyOn(vscode.workspace.fs, 'readFile').mockImplementation(async (uri: any) =>
      new TextEncoder().encode(uri.fsPath.endsWith('.md') ? '# Guia do projeto' : 'export const value = 1;')
    );

    const manager = new AdvancedContextManager(createStorage(createGroup(['docs/guide.md'])));
    const context = await manager.getContextString();

    expect(context).toContain('docs/guide.md');
    expect(context).toContain('# Guia do projeto');
  });

  it('uses VS Code globs for nested files and only the selected group', async () => {
    const otherFile = { fsPath: '/workspace/other/ignored.ts' };
    const findFiles = vi.spyOn(vscode.workspace, 'findFiles').mockImplementation(async (pattern: any) => {
      if (pattern === 'src/**') return [workspaceFiles[1]] as any;
      if (pattern === 'other/**') return [otherFile] as any;
      return [];
    });
    vi.spyOn(vscode.workspace, 'asRelativePath').mockImplementation((uri: any) =>
      uri.fsPath.replace('/workspace/', '')
    );
    vi.spyOn(vscode.workspace.fs, 'readFile').mockImplementation(async (uri: any) =>
      new TextEncoder().encode(`content from ${uri.fsPath}`)
    );

    const group = createGroup([], ['src/**']);
    const manager = new AdvancedContextManager(createStorage(group));
    const context = await manager.getContextString();

    expect(findFiles).toHaveBeenCalledWith('src/**', expect.any(String), expect.any(Number));
    expect(context).toContain('src/nested/module.ts');
    expect(context).not.toContain('ignored.ts');
  });

  it('activates a group created from manually selected files', async () => {
    vi.spyOn(vscode.workspace, 'findFiles').mockResolvedValue([workspaceFiles[0]] as any);
    vi.spyOn(vscode.workspace, 'asRelativePath').mockImplementation((uri: any) =>
      uri.fsPath.replace('/workspace/', '')
    );
    vi.spyOn(vscode.window, 'showQuickPick').mockResolvedValue([{ uri: workspaceFiles[0] }] as any);
    vi.spyOn(vscode.workspace.fs, 'readFile').mockResolvedValue(new TextEncoder().encode('# Guia'));

    const { storage, read } = createEmptyStorage();
    const manager = new AdvancedContextManager(storage);
    const group = await manager.createGroupFromQuickPick(storage);

    expect(group).not.toBeNull();
    expect(read()?.selectedGroupId).toBe(group?.id);
    expect(await manager.getContextString()).toContain('# Guia');
  });
});