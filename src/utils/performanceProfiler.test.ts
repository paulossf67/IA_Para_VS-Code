import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PerformanceProfiler } from './performanceProfiler';
import { chat } from './ollama';

vi.mock('./ollama', () => ({
  chat: vi.fn(),
}));

describe('PerformanceProfiler', () => {
  let profiler: PerformanceProfiler;

  beforeEach(() => {
    profiler = new PerformanceProfiler();
    vi.clearAllMocks();
  });

  describe('analyzeCode', () => {
    it('detects nested loops (O(n²))', async () => {
      const code = `
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < m; j++) {
            doSomething();
          }
        }
      `;
      const issues = await profiler.analyzeCode(code, 'typescript');

      expect(issues.some(i => i.issue.includes('Nested loops'))).toBe(true);
      expect(issues.some(i => i.complexity === 'O(n²)')).toBe(true);
      expect(issues.some(i => i.severity === 'warning')).toBe(true);
    });

    it('detects eval() usage', async () => {
      const code = `eval('malicious code');`;
      const issues = await profiler.analyzeCode(code, 'javascript');

      expect(issues.some(i => i.issue.includes('eval()'))).toBe(true);
      expect(issues.some(i => i.complexity === 'Very Slow')).toBe(true);
    });

    it('detects for-in on Object', async () => {
      const code = `for (const key in Object) { console.log(key); }`;
      const issues = await profiler.analyzeCode(code, 'typescript');

      expect(issues.some(i => i.issue.includes('for-in'))).toBe(true);
      expect(issues.some(i => i.suggestion.includes('Object.keys'))).toBe(true);
    });

    it('returns line numbers correctly', async () => {
      const code = `
        function test() {
          for (let i = 0; i < 10; i++) {
            for (let j = 0; j < 10; j++) {
              console.log(i, j);
            }
          }
        }
      `;
      const issues = await profiler.analyzeCode(code, 'typescript');

      const nestedLoopIssue = issues.find(i => i.issue.includes('Nested loops'));
      expect(nestedLoopIssue).toBeDefined();
      expect(nestedLoopIssue!.line).toBeGreaterThan(0);
    });

    it('returns empty array for clean code', async () => {
      const code = `function add(a: number, b: number): number { return a + b; }`;
      const issues = await profiler.analyzeCode(code, 'typescript');

      expect(issues.length).toBe(0);
    });

    it('sorts issues by line number', async () => {
      const code = `
        eval('first');
        for (let i = 0; i < 10; i++) {
          for (let j = 0; j < 10; j++) {}
        }
      `;
      const issues = await profiler.analyzeCode(code, 'typescript');

      for (let i = 1; i < issues.length; i++) {
        expect(issues[i].line).toBeGreaterThanOrEqual(issues[i - 1].line);
      }
    });

    it('calls AI analysis when few pattern issues found', async () => {
      (chat as vi.Mock).mockResolvedValue('[{"line": 5, "issue": "AI issue", "complexity": "O(n)", "suggestion": "AI suggestion"}]');
      
      const code = `function simple() { return 1; }`; // No pattern matches
      const issues = await profiler.analyzeCode(code, 'typescript');

      expect(chat).toHaveBeenCalled();
    });

    it('includes AI issues in results', async () => {
      (chat as vi.Mock).mockResolvedValue('[{"line": 10, "issue": "AI detected", "complexity": "O(n log n)", "suggestion": "Use better algo"}]');
      
      const code = `function simple() { return 1; }`;
      const issues = await profiler.analyzeCode(code, 'typescript');

      expect(issues.some(i => i.issue === 'AI detected')).toBe(true);
    });

    it('handles AI analysis failure gracefully', async () => {
      (chat as vi.Mock).mockRejectedValue(new Error('AI failed'));
      
      const code = `function simple() { return 1; }`;
      const issues = await profiler.analyzeCode(code, 'typescript');

      expect(Array.isArray(issues)).toBe(true);
    });

    it('limits AI analysis to when issues < 5', async () => {
      (chat as vi.Mock).mockResolvedValue('[{"line": 1, "issue": "AI issue", "complexity": "O(1)", "suggestion": "fix"}]');
      
      const code = `
        eval('1');
        eval('2');
        eval('3');
        eval('4');
        eval('5');
        eval('6');
      `;
      await profiler.analyzeCode(code, 'javascript');

      // Should not call AI since we already have 6 pattern matches (> 5)
      expect(chat).not.toHaveBeenCalled();
    });
  });

  describe('showReport', () => {
    it('shows info message when no issues', async () => {
      const showInfo = vi.spyOn(require('vscode').window, 'showInformationMessage').mockResolvedValue(undefined);
      
      await profiler.showReport([]);

      expect(showInfo).toHaveBeenCalledWith('✅ No performance issues detected');
    });

    it('creates webview panel with issues', async () => {
      const createPanel = vi.spyOn(require('vscode').window, 'createWebviewPanel').mockReturnValue({
        webview: { html: '' },
      });

      await profiler.showReport([
        { location: 'Line 5', line: 5, severity: 'warning', issue: 'Test issue', complexity: 'O(n²)', suggestion: 'Fix it', estimatedFix: 'Refactor' },
      ]);

      expect(createPanel).toHaveBeenCalled();
    });
  });
});