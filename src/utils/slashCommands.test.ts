import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SlashCommandManager, BUILTIN_COMMANDS } from './slashCommands';

vi.mock('vscode', () => ({
  Memento: class {
    private store = new Map();
    get(key: string, defaultValue?: any) { return this.store.get(key) ?? defaultValue; }
    update(key: string, value: any) { this.store.set(key, value); return Promise.resolve(); }
  },
}));

describe('SlashCommandManager', () => {
  let manager: SlashCommandManager;
  let mockStorage: any;

  beforeEach(() => {
    mockStorage = {
      store: new Map(),
      get: vi.fn((key: string, defaultValue?: any) => mockStorage.store.get(key) ?? defaultValue),
      update: vi.fn((key: string, value: any) => { mockStorage.store.set(key, value); return Promise.resolve(); }),
    };
    manager = new SlashCommandManager(mockStorage);
  });

  describe('load', () => {
    it('loads builtin commands', () => {
      const commands = manager.getAll();
      expect(commands.length).toBeGreaterThanOrEqual(BUILTIN_COMMANDS.length);
      
      const reviewCmd = manager.get('review');
      expect(reviewCmd).toBeDefined();
      expect(reviewCmd?.builtin).toBe(true);
    });

    it('loads user commands from storage', () => {
      const userCmd = { name: 'custom', description: 'Custom command', prompt: 'Do something {selection}' };
      mockStorage.store.set('local-ai.slashCommands', [userCmd]);
      
      const newManager = new SlashCommandManager(mockStorage);
      const cmd = newManager.get('custom');
      expect(cmd).toBeDefined();
      expect(cmd?.builtin).toBe(false);
    });
  });

  describe('get', () => {
    it('returns builtin command', () => {
      const cmd = manager.get('review');
      expect(cmd).toBeDefined();
      expect(cmd?.name).toBe('review');
      expect(cmd?.builtin).toBe(true);
    });

    it('returns undefined for non-existent', () => {
      expect(manager.get('nonexistent')).toBeUndefined();
    });
  });

  describe('add', () => {
    it('adds new user command', async () => {
      const cmd = { name: 'mycmd', description: 'My command', prompt: 'Prompt {selection}' };
      await manager.add(cmd);
      
      const added = manager.get('mycmd');
      expect(added).toBeDefined();
      expect(added?.builtin).toBe(false);
    });

    it('throws for duplicate name', async () => {
      await manager.add({ name: 'review', description: 'Test', prompt: 'Test' });
      await expect(manager.add({ name: 'review', description: 'Test2', prompt: 'Test2' })).rejects.toThrow('já existe');
    });

    it('throws for builtin name', async () => {
      await expect(manager.add({ name: 'review', description: 'Test', prompt: 'Test' })).rejects.toThrow('já existe');
    });
  });

  describe('update', () => {
    it('updates user command', async () => {
      await manager.add({ name: 'mycmd', description: 'Old', prompt: 'Old {selection}' });
      await manager.update('mycmd', { description: 'New', prompt: 'New {selection}' });
      
      const updated = manager.get('mycmd');
      expect(updated?.description).toBe('New');
      expect(updated?.prompt).toBe('New {selection}');
    });

    it('throws for non-existent', async () => {
      await expect(manager.update('nonexistent', { description: 'New' })).rejects.toThrow('não encontrado');
    });

    it('throws for builtin', async () => {
      await expect(manager.update('review', { description: 'New' })).rejects.toThrow('built-in');
    });
  });

  describe('delete', () => {
    it('deletes user command', async () => {
      await manager.add({ name: 'mycmd', description: 'Test', prompt: 'Test {selection}' });
      await manager.delete('mycmd');
      expect(manager.get('mycmd')).toBeUndefined();
    });

    it('throws for non-existent', async () => {
      await expect(manager.delete('nonexistent')).rejects.toThrow('não encontrado');
    });

    it('throws for builtin', async () => {
      await expect(manager.delete('review')).rejects.toThrow('built-in');
    });
  });

  describe('expandPrompt', () => {
    it('replaces all placeholders', () => {
      const template = 'File: {file}, Lang: {language}, Line: {line}, Code: {selection}';
      const result = new SlashCommandManager({} as any).expandPrompt(template, {
        selection: 'const x = 1;',
        file: '/test/file.ts',
        language: 'typescript',
        line: 10,
      });
      
      expect(result).toContain('File: /test/file.ts');
      expect(result).toContain('Lang: typescript');
      expect(result).toContain('Line: 10');
      expect(result).toContain('Code: const x = 1;');
    });

    it('handles missing optional fields', () => {
      const template = 'File: {file}, Code: {selection}';
      const result = new SlashCommandManager({} as any).expandPrompt(template, {
        selection: 'code',
        language: 'js',
      });
      
      expect(result).toContain('File: ');
      expect(result).toContain('Code: code');
    });
  });

  describe('getBuiltin', () => {
    it('returns all builtin commands', () => {
      const builtins = manager.getBuiltin();
      expect(builtins.length).toBe(BUILTIN_COMMANDS.length);
      expect(builtins.every(c => c.builtin)).toBe(true);
    });
  });

  describe('getUserCommands', () => {
    it('returns only user commands', async () => {
      await manager.add({ name: 'usercmd', description: 'Test', prompt: 'Test' });
      const userCmds = manager.getUserCommands();
      expect(userCmds.every(c => !c.builtin)).toBe(true);
      expect(userCmds.some(c => c.name === 'usercmd')).toBe(true);
    });
  });
});