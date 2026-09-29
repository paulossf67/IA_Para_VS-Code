import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as vscode from 'vscode';
import { SnippetManager } from './snippetManager';

vi.mock('vscode', () => ({
  Memento: class {
    private store = new Map();
    get(key: string, defaultValue?: any) { return this.store.get(key) ?? defaultValue; }
    update(key: string, value: any) { this.store.set(key, value); return Promise.resolve(); }
  },
  Uri: { file: (path: string) => ({ fsPath: path }) },
  workspace: {
    get workspaceFolders() { return []; },
  },
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(() => '{}'),
  unlinkSync: vi.fn(),
  readdirSync: vi.fn(() => []),
}));

vi.mock('path', () => ({
  join: (...args: string[]) => args.join('/'),
  dirname: (p: string) => p.split('/').slice(0, -1).join('/'),
}));

describe('SnippetManager', () => {
  let manager: SnippetManager;
  let mockStorage: any;

  beforeEach(() => {
    mockStorage = {
      store: new Map(),
      get: vi.fn((key: string, defaultValue?: any) => mockStorage.store.get(key) ?? defaultValue),
      update: vi.fn((key: string, value: any) => { mockStorage.store.set(key, value); return Promise.resolve(); }),
    };
    manager = new SnippetManager(mockStorage, '/fake/extension/path');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createSnippet', () => {
    it('creates snippet with all fields', async () => {
      const snippet = await manager.createSnippet(
        'Test Snippet',
        'console.log("hello");',
        'javascript',
        ['test', 'logging']
      );

      expect(snippet.name).toBe('Test Snippet');
      expect(snippet.code).toBe('console.log("hello");');
      expect(snippet.language).toBe('javascript');
      expect(snippet.tags).toEqual(['test', 'logging']);
      expect(snippet.rating).toBe(0);
      expect(snippet.usedCount).toBe(0);
      expect(snippet.id).toMatch(/^snippet-\d+/);
      expect(snippet.createdAt).toBeInstanceOf(Date);
      expect(snippet.updatedAt).toBeInstanceOf(Date);
    });

    it('creates snippet with empty tags by default', async () => {
      const snippet = await manager.createSnippet('Test', 'code', 'js');
      expect(snippet.tags).toEqual([]);
    });
  });

  describe('loadSnippets', () => {
    it('returns empty array when no snippets stored', async () => {
      const snippets = await manager.loadSnippets();
      expect(snippets).toEqual([]);
    });

    it('loads snippets from storage and files', async () => {
      const mockSnippet = {
        id: 'snippet-123',
        name: 'Test',
        code: 'code',
        language: 'js',
        description: '',
        tags: [],
        rating: 0,
        usedCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const fs = require('fs');
      fs.readFileSync.mockReturnValue(JSON.stringify(mockSnippet));
      mockStorage.get.mockReturnValue(['snippet-123']);

      const snippets = await manager.loadSnippets();
      expect(snippets.length).toBe(1);
      expect(snippets[0].name).toBe('Test');
    });

    it('respects MAX_SNIPPETS limit', async () => {
      const ids = Array.from({ length: 600 }, (_, i) => `snippet-${i}`);
      mockStorage.get.mockReturnValue(ids);

      const fs = require('fs');
      fs.readFileSync.mockReturnValue(JSON.stringify({ id: 'x', name: 'x', code: 'x', language: 'js', description: '', tags: [], rating: 0, usedCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));

      const snippets = await manager.loadSnippets();
      expect(snippets.length).toBeLessThanOrEqual(500);
    });
  });

  describe('saveSnippet / loadSnippet', () => {
    it('saves snippet to file and updates storage', async () => {
      const snippet = await manager.createSnippet('Test', 'code', 'js');
      
      const fs = require('fs');
      expect(fs.writeFileSync).toHaveBeenCalled();
      expect(mockStorage.update).toHaveBeenCalled();
    });

    it('loads existing snippet by id', async () => {
      const mockSnippet = {
        id: 'snippet-123',
        name: 'Test',
        code: 'code',
        language: 'js',
        description: 'desc',
        tags: ['tag1'],
        rating: 5,
        usedCount: 10,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const fs = require('fs');
      fs.readFileSync.mockReturnValue(JSON.stringify(mockSnippet));

      const loaded = await manager.loadSnippet('snippet-123');
      expect(loaded).not.toBeNull();
      expect(loaded!.name).toBe('Test');
      expect(loaded!.rating).toBe(5);
    });

    it('returns null for non-existent snippet', async () => {
      const fs = require('fs');
      fs.existsSync.mockReturnValue(false);

      const loaded = await manager.loadSnippet('non-existent');
      expect(loaded).toBeNull();
    });
  });

  describe('deleteSnippet', () => {
    it('deletes file and removes from storage', async () => {
      const fs = require('fs');
      fs.existsSync.mockReturnValue(true);
      mockStorage.get.mockReturnValue(['snippet-123']);

      await manager.deleteSnippet('snippet-123');

      expect(fs.unlinkSync).toHaveBeenCalled();
      expect(mockStorage.update).toHaveBeenCalledWith('local-ai.snippets', []);
    });
  });

  describe('rateSnippet', () => {
    it('updates rating and clamps to 0-5', async () => {
      const mockSnippet = {
        id: 'snippet-123',
        name: 'Test',
        code: 'code',
        language: 'js',
        description: '',
        tags: [],
        rating: 0,
        usedCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const fs = require('fs');
      fs.readFileSync.mockReturnValue(JSON.stringify(mockSnippet));
      fs.existsSync.mockReturnValue(true);

      await manager.rateSnippet('snippet-123', 10); // Should clamp to 5

      expect(fs.writeFileSync).toHaveBeenCalled();
      const written = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
      expect(written.rating).toBe(5);
    });

    it('does nothing for non-existent snippet', async () => {
      const fs = require('fs');
      fs.existsSync.mockReturnValue(false);

      await manager.rateSnippet('non-existent', 3);
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });
  });

  describe('incrementUsedCount', () => {
    it('increments usedCount and updates timestamp', async () => {
      const mockSnippet = {
        id: 'snippet-123',
        name: 'Test',
        code: 'code',
        language: 'js',
        description: '',
        tags: [],
        rating: 0,
        usedCount: 5,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const fs = require('fs');
      fs.readFileSync.mockReturnValue(JSON.stringify(mockSnippet));
      fs.existsSync.mockReturnValue(true);

      await manager.incrementUsedCount('snippet-123');

      const written = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
      expect(written.usedCount).toBe(6);
    });
  });

  describe('searchSnippets', () => {
    it('searches by name', async () => {
      const snippets = [
        { id: '1', name: 'React Component', code: '', language: 'tsx', description: '', tags: [], rating: 0, usedCount: 0, createdAt: new Date(), updatedAt: new Date() },
        { id: '2', name: 'API Handler', code: '', language: 'ts', description: '', tags: [], rating: 0, usedCount: 0, createdAt: new Date(), updatedAt: new Date() },
      ];
      vi.spyOn(manager, 'loadSnippets').mockResolvedValue(snippets as any);

      const results = await manager.searchSnippets('react');
      expect(results.length).toBe(1);
      expect(results[0].name).toBe('React Component');
    });

    it('searches by tags', async () => {
      const snippets = [
        { id: '1', name: 'Test', code: '', language: 'js', description: '', tags: ['react', 'hook'], rating: 0, usedCount: 0, createdAt: new Date(), updatedAt: new Date() },
        { id: '2', name: 'Other', code: '', language: 'js', description: '', tags: ['api'], rating: 0, usedCount: 0, createdAt: new Date(), updatedAt: new Date() },
      ];
      vi.spyOn(manager, 'loadSnippets').mockResolvedValue(snippets as any);

      const results = await manager.searchSnippets('hook');
      expect(results.length).toBe(1);
    });

    it('searches by language', async () => {
      const snippets = [
        { id: '1', name: 'Test', code: '', language: 'typescript', description: '', tags: [], rating: 0, usedCount: 0, createdAt: new Date(), updatedAt: new Date() },
        { id: '2', name: 'Other', code: '', language: 'python', description: '', tags: [], rating: 0, usedCount: 0, createdAt: new Date(), updatedAt: new Date() },
      ];
      vi.spyOn(manager, 'loadSnippets').mockResolvedValue(snippets as any);

      const results = await manager.searchSnippets('type');
      expect(results.length).toBe(1);
    });
  });

  describe('exportSnippets / importSnippets', () => {
    it('exports snippets as JSON', async () => {
      const snippets = [{ id: '1', name: 'Test', code: 'code', language: 'js', description: '', tags: [], rating: 0, usedCount: 0, createdAt: new Date(), updatedAt: new Date() }];
      vi.spyOn(manager, 'loadSnippets').mockResolvedValue(snippets as any);

      const json = await manager.exportSnippets();
      const parsed = JSON.parse(json);
      expect(parsed.length).toBe(1);
      expect(parsed[0].name).toBe('Test');
    });

    it('imports valid snippets and returns count', async () => {
      const json = JSON.stringify([
        { id: '1', name: 'Test', code: 'code', language: 'js', description: '', tags: [], rating: 0, usedCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        { id: '2', name: 'Test2', code: '', language: 'js', description: '', tags: [], rating: 0, usedCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, // invalid - no code
      ]);

      const count = await manager.importSnippets(json);
      expect(count).toBe(1);
    });

    it('handles invalid JSON gracefully', async () => {
      const count = await manager.importSnippets('invalid json');
      expect(count).toBe(0);
    });
  });

  describe('getTopRated / getMostUsed', () => {
    it('returns top rated snippets', async () => {
      const snippets = [
        { id: '1', name: 'Low', code: '', language: 'js', description: '', tags: [], rating: 2, usedCount: 0, createdAt: new Date(), updatedAt: new Date() },
        { id: '2', name: 'High', code: '', language: 'js', description: '', tags: [], rating: 5, usedCount: 0, createdAt: new Date(), updatedAt: new Date() },
        { id: '3', name: 'Medium', code: '', language: 'js', description: '', tags: [], rating: 3, usedCount: 0, createdAt: new Date(), updatedAt: new Date() },
      ];
      vi.spyOn(manager, 'loadSnippets').mockResolvedValue(snippets as any);

      const top = await manager.getTopRated(2);
      expect(top.length).toBe(2);
      expect(top[0].name).toBe('High');
      expect(top[1].name).toBe('Medium');
    });

    it('returns most used snippets', async () => {
      const snippets = [
        { id: '1', name: 'Rare', code: '', language: 'js', description: '', tags: [], rating: 0, usedCount: 1, createdAt: new Date(), updatedAt: new Date() },
        { id: '2', name: 'Popular', code: '', language: 'js', description: '', tags: [], rating: 0, usedCount: 100, createdAt: new Date(), updatedAt: new Date() },
      ];
      vi.spyOn(manager, 'loadSnippets').mockResolvedValue(snippets as any);

      const most = await manager.getMostUsed(1);
      expect(most[0].name).toBe('Popular');
    });
  });
});