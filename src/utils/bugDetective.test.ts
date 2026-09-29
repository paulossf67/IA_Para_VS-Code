import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BugDetective } from './bugDetective';
import { chat } from './ollama';

vi.mock('./ollama', () => ({
  chat: vi.fn(),
}));

describe('BugDetective', () => {
  let detective: BugDetective;

  beforeEach(() => {
    detective = new BugDetective();
    vi.clearAllMocks();
  });

  describe('analyzeCode', () => {
    it('detects hardcoded secrets', async () => {
      const code = `const apiKey = "sk-12345";\nconst password = 'secret123';`;
      const analysis = await detective.analyzeCode(code, 'typescript');

      expect(analysis.patterns.some(p => p.pattern === 'hardcoded_secrets')).toBe(true);
      expect(analysis.riskScore).toBeGreaterThanOrEqual(20);
    });

    it('detects missing error handling on await', async () => {
      const code = `await fetchData();\nawait processData();`;
      const analysis = await detective.analyzeCode(code, 'typescript');

      expect(analysis.patterns.some(p => p.pattern === 'missing_error_handling')).toBe(true);
      expect(analysis.riskScore).toBeGreaterThanOrEqual(10);
    });

    it('detects SQL injection risk', async () => {
      const code = `db.query(\`SELECT * FROM users WHERE id = \${userId}\`);`;
      const analysis = await detective.analyzeCode(code, 'typescript');

      expect(analysis.patterns.some(p => p.pattern === 'sql_injection')).toBe(true);
      expect(analysis.riskScore).toBeGreaterThanOrEqual(20);
    });

    it('detects infinite loop patterns', async () => {
      const code = `while (true) { doSomething(); }\nfor (;;) { loop(); }`;
      const analysis = await detective.analyzeCode(code, 'typescript');

      expect(analysis.patterns.some(p => p.pattern === 'infinite_loop')).toBe(true);
      expect(analysis.riskScore).toBeGreaterThanOrEqual(10);
    });

    it('detects race condition patterns', async () => {
      const code = `let shared = 0;\nasync function test() { shared++; }`;
      const analysis = await detective.analyzeCode(code, 'typescript');

      expect(analysis.patterns.some(p => p.pattern === 'race_condition')).toBe(true);
      expect(analysis.riskScore).toBeGreaterThanOrEqual(10);
    });

    it('returns empty patterns for clean code', async () => {
      const code = `function add(a: number, b: number): number {\n  return a + b;\n}`;
      const analysis = await detective.analyzeCode(code, 'typescript');

      expect(analysis.patterns.length).toBe(0);
      expect(analysis.riskScore).toBe(0);
    });

    it('sorts patterns by severity (critical first)', async () => {
      const code = `
        const apiKey = "secret";
        await fetchData();
      `;
      const analysis = await detective.analyzeCode(code, 'typescript');

      const severities = analysis.patterns.map(p => p.severity);
      expect(severities[0]).toBe('critical');
    });

    it('calls AI analysis for code > 200 chars', async () => {
      (chat as vi.Mock).mockResolvedValue('[{"pattern": "ai_found", "severity": "warning", "description": "AI found issue", "fix": "fix it"}]');
      
      const longCode = 'x'.repeat(300);
      await detective.analyzeCode(longCode, 'typescript');

      expect(chat).toHaveBeenCalled();
    });

    it('handles AI analysis failure gracefully', async () => {
      (chat as vi.Mock).mockRejectedValue(new Error('AI failed'));
      
      const longCode = 'x'.repeat(300);
      const analysis = await detective.analyzeCode(longCode, 'typescript');

      expect(analysis.patterns).toEqual([]);
    });
  });

  describe('detectPatterns', () => {
    it('returns unique pattern names', () => {
      const code = `
        const apiKey = "secret";
        await fetchData();
        const apiKey2 = "secret2";
      `;
      const patterns = detective.detectPatterns(code);

      expect(patterns).toContain('Hardcoded secrets');
      expect(patterns).toContain('Missing error handling');
      expect(new Set(patterns).size).toBe(patterns.length);
    });

    it('detects SQL injection and infinite loops', () => {
      const code = `
        db.query(\`SELECT * FROM t WHERE id = \${id}\`);
        while (true) {}
      `;
      const patterns = detective.detectPatterns(code);

      expect(patterns).toContain('SQL injection risk');
      expect(patterns).toContain('Infinite loop');
    });
  });

  describe('showAnalysisReport', () => {
    it('shows info message when no bugs', async () => {
      const showInfo = vi.spyOn(require('vscode').window, 'showInformationMessage').mockResolvedValue(undefined);
      
      await detective.showAnalysisReport({
        patterns: [],
        riskScore: 0,
        timestamp: new Date(),
      });

      expect(showInfo).toHaveBeenCalledWith('✅ Nenhum bug detectado');
    });

    it('creates webview panel with report', async () => {
      const createPanel = vi.spyOn(require('vscode').window, 'createWebviewPanel').mockReturnValue({
        webview: { html: '' },
      });

      await detective.showAnalysisReport({
        patterns: [{ pattern: 'test', severity: 'critical', description: 'desc', examples: [], suggestedFix: 'fix', detectedCount: 1 }],
        riskScore: 80,
        timestamp: new Date(),
      });

      expect(createPanel).toHaveBeenCalled();
    });
  });
});