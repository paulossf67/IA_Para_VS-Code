import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CodeGenetics } from './codeGenetics';
import { chat } from './ollama';

vi.mock('./ollama', () => ({
  chat: vi.fn(),
}));

vi.mock('vscode', () => ({
  extensions: {
    getExtension: vi.fn(() => ({
      isActive: true,
      exports: {
        getAPI: vi.fn(() => ({
          repositories: [{
            log: vi.fn().mockResolvedValue([
              { hash: 'abc12345', message: 'Fix bug in auth', author: { name: 'Test' }, parents: [] },
              { hash: 'def67890', message: 'Refactor user service', author: { name: 'Test' }, parents: [] },
            ]),
            diffWithHEAD: vi.fn().mockResolvedValue('diff content'),
          }],
        })),
      })),
    }),
    workspace: { workspaceFolders: [{ uri: { fsPath: '/fake/workspace' } }] },
    Uri: { file: (p: string) => ({ fsPath: p }) },
}));

describe('CodeGenetics', () => {
  let genetics: CodeGenetics;
  let mockContext: any;

  beforeEach(() => {
    mockContext = {
      globalState: {
        get: vi.fn(() => []),
        update: vi.fn(),
      },
    };
    genetics = new CodeGenetics(mockContext);
    vi.clearAllMocks();
  });

  describe('analyzeFileEvolution', () => {
    it('returns evolution events from git log', async () => {
      const events = await genetics.analyzeFileEvolution('/fake/workspace/src/auth.ts', 10);

      expect(events.length).toBeGreaterThan(0);
      expect(events[0]).toHaveProperty('commit');
      expect(events[0]).toHaveProperty('message');
      expect(events[0]).toHaveProperty('category');
    });

    it('categorizes commits correctly', async () => {
      const events = await genetics.analyzeFileEvolution('/fake/workspace/src/auth.ts', 10);
      
      const categories = events.map(e => e.category);
      expect(categories).toContain('fix'); // "Fix bug in auth"
      expect(categories).toContain('refactor'); // "Refactor user service"
    });

    it('handles missing git extension', async () => {
      vi.doMock('vscode', () => ({
        extensions: { getExtension: vi.fn(() => undefined) },
        workspace: { workspaceFolders: [{ uri: { fsPath: '/fake/workspace' } }] },
        Uri: { file: (p: string) => ({ fsPath: p }) },
      }));

      const newGenetics = new CodeGenetics(mockContext);
      const events = await newGenetics.analyzeFileEvolution('/fake/file.ts');
      expect(events).toEqual([]);
    });

    it('handles missing repositories', async () => {
      vi.doMock('vscode', () => ({
        extensions: {
          getExtension: vi.fn(() => ({
            isActive: true,
            exports: { getAPI: vi.fn(() => ({ repositories: [] })) },
          })),
        },
        workspace: { workspaceFolders: [{ uri: { fsPath: '/fake/workspace' } }] },
        Uri: { file: (p: string) => ({ fsPath: p }) },
      }));

      const newGenetics = new CodeGenetics(mockContext);
      const events = await newGenetics.analyzeFileEvolution('/fake/file.ts');
      expect(events).toEqual([]);
    });
  });

  describe('analyzeFunctionEvolution', () => {
    it('returns function evolution with events', async () => {
      const evolution = await genetics.analyzeFunctionEvolution('/fake/workspace/src/auth.ts', 'login', 10);

      expect(evolution).not.toBeNull();
      expect(evolution).toHaveProperty('name', 'login');
      expect(evolution).toHaveProperty('events');
      expect(evolution).toHaveProperty('summary');
      expect(evolution).toHaveProperty('currentCode');
    });

    it('returns null for non-existent function', async () => {
      const evolution = await genetics.analyzeFunctionEvolution('/fake/workspace/src/auth.ts', 'nonExistentFunction');
      expect(evolution).toBeNull();
    });
  });

  describe('analyzeWithAI (semantic summary)', () => {
    it('calls chat API for semantic analysis', async () => {
      (chat as vi.Mock).mockResolvedValue('Fixed null check in login function');

      const summary = await genetics['analyzeSemanticChange']('diff content', 'auth.ts');

      expect(chat).toHaveBeenCalled();
      expect(summary).toContain('Fixed null check');
    });

    it('returns fallback when AI fails', async () => {
      (chat as vi.Mock).mockRejectedValue(new Error('AI failed'));

      const summary = await genetics['analyzeSemanticChange']('diff content', 'auth.ts');
      expect(summary).toBe('Change detected (AI analysis failed)');
    });
  });

  describe('categorizeCommit', () => {
    it('categorizes fix commits', () => {
      expect(genetics['categorizeCommit']('fix bug', '')).toBe('fix');
      expect(genetics['categorizeCommit']('Bug fix for auth', '')).toBe('fix');
      expect(genetics['categorizeCommit']('error handling', '')).toBe('fix');
    });

    it('categorizes refactor commits', () => {
      expect(genetics['categorizeCommit']('refactor user service', '')).toBe('refactor');
      expect(genetics['categorizeCommit']('cleanup code', '')).toBe('refactor');
    });

    it('categorizes test commits', () => {
      expect(genetics['categorizeCommit']('add tests', '')).toBe('test');
      expect(genetics['categorizeCommit']('spec for login', '')).toBe('test');
    });

    it('categorizes docs commits', () => {
      expect(genetics['categorizeCommit']('update readme', '')).toBe('docs');
    });

    it('categorizes style commits', () => {
      expect(genetics['categorizeCommit']('format code', '')).toBe('style');
    });

    it('categorizes feature commits', () => {
      expect(genetics['categorizeCommit']('add new feature', '')).toBe('feature');
    });

    it('defaults to other', () => {
      expect(genetics['categorizeCommit']('misc changes', '')).toBe('other');
    });
  });

  describe('extractFunction', () => {
    it('extracts function by name', async () => {
      const fs = require('fs');
      fs.readFileSync.mockReturnValue(`
        function login(user: User): Token {
          return generateToken(user);
        }
        
        function logout() {
          clearSession();
        }
      `);

      const code = await genetics['extractFunction']('/fake/auth.ts', 'login');
      expect(code).toContain('function login');
      expect(code).not.toContain('function logout');
    });

    it('extracts arrow function', async () => {
      const fs = require('fs');
      fs.readFileSync.mockReturnValue(`
        const login = (user: User): Token => {
          return generateToken(user);
        }
      `);

      const code = await genetics['extractFunction']('/fake/auth.ts', 'login');
      expect(code).toContain('const login');
    });

    it('returns null for missing function', async () => {
      const fs = require('fs');
      fs.readFileSync.mockReturnValue('function other() {}');

      const code = await genetics['extractFunction']('/fake/auth.ts', 'login');
      expect(code).toBeNull();
    });
  });

  describe('generateEvolutionSummary', () => {
    it('generates summary from events', async () => {
      (chat as vi.Mock).mockResolvedValue('The login function evolved through 2 commits, mainly focusing on bug fixes.');

      const events = [
        { date: '2024-01-01', category: 'fix', semanticSummary: 'Fixed null check' },
        { date: '2024-01-02', category: 'refactor', semanticSummary: 'Improved error handling' },
      ];

      const summary = await genetics['generateEvolutionSummary']('login', events);
      expect(summary).toContain('evolved');
    });

    it('returns fallback for insufficient history', async () => {
      const summary = await genetics['generateEvolutionSummary']('login', []);
      expect(summary).toContain('Not enough history');
    });
  });

  describe('showEvolutionUI', () => {
    it('shows warning when no active editor', async () => {
      vi.doMock('vscode', () => ({
        window: {
          activeTextEditor: undefined,
          showWarningMessage: vi.fn(),
        },
      }));

      const newGenetics = new CodeGenetics(mockContext);
      await newGenetics.showEvolutionUI();

      // Should show warning about no active editor
    });
  });
});