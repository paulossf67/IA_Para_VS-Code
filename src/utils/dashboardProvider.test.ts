import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DashboardProvider } from './dashboardProvider';
import { QualityScoreTracker } from './qualityScore';
import { BugDetective } from './bugDetective';
import { PerformanceProfiler } from './performanceProfiler';

vi.mock('./qualityScore', () => ({
  QualityScoreTracker: vi.fn().mockImplementation(() => ({
    getWeeklyStats: vi.fn().mockResolvedValue({
      averageScore: 75.5,
      trend: 5,
      topCategory: 'refactor',
      bottomCategory: 'test',
    }),
    loadMetrics: vi.fn().mockResolvedValue([
      { autoScore: 80, category: 'refactor' },
      { autoScore: 70, category: 'test' },
    ]),
  })),
}));

vi.mock('./bugDetective', () => ({
  BugDetective: vi.fn().mockImplementation(() => ({
    analyzeCode: vi.fn().mockResolvedValue({
      patterns: [
        { pattern: 'hardcoded_secrets', severity: 'critical', detectedCount: 1 },
        { pattern: 'missing_error_handling', severity: 'warning', detectedCount: 2 },
      ],
      riskScore: 40,
      timestamp: new Date(),
    }),
  })),
}));

vi.mock('./performanceProfiler', () => ({
  PerformanceProfiler: vi.fn().mockImplementation(() => ({
    analyzeCode: vi.fn().mockResolvedValue([
      { severity: 'warning', issue: 'Nested loops detected', complexity: 'O(n²)' },
    ]),
  })),
}));

vi.mock('vscode', () => ({
  ExtensionContext: class {},
  Uri: { file: (p: string) => ({ fsPath: p }) },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: '/fake/workspace' } }],
    findFiles: vi.fn().mockResolvedValue([
      { fsPath: '/fake/workspace/src/main.ts' },
      { fsPath: '/fake/workspace/src/test.ts' },
      { fsPath: '/fake/workspace/package.json' },
    ]),
  },
  window: {
    createWebviewView: vi.fn(),
  },
  ViewColumn: { Two: 2 },
}));

vi.mock('fs', () => ({
  readFileSync: vi.fn((path: string) => {
    if (path.endsWith('.ts')) return 'export function test() { return 1; }';
    if (path.endsWith('package.json')) return '{"name": "test"}';
    return '';
  }),
  existsSync: vi.fn(() => true),
}));

vi.mock('path', () => ({
  extname: (p: string) => p.split('.').pop() ? '.' + p.split('.').pop() : '',
  join: (...args: string[]) => args.join('/'),
  dirname: (p: string) => p.split('/').slice(0, -1).join('/'),
}));

describe('DashboardProvider', () => {
  let provider: DashboardProvider;
  let mockContext: any;

  beforeEach(() => {
    mockContext = {
      globalState: {
        get: vi.fn(() => []),
        update: vi.fn(),
      },
    };
    provider = new DashboardProvider('/fake/extension', mockContext);
    vi.clearAllMocks();
  });

  describe('updateProjectMetrics', () => {
    it('calculates project metrics from workspace files', async () => {
      await provider['updateProjectMetrics']();

      const data = (provider as any).data;
      expect(data.project).toBeDefined();
      expect(data.project.totalFiles).toBeGreaterThan(0);
      expect(data.project.linesOfCode).toBeGreaterThan(0);
      expect(data.project.languages).toBeDefined();
      expect(data.project.testsFound).toBeGreaterThanOrEqual(0);
      expect(data.project.docCoverage).toBeGreaterThanOrEqual(0);
    });

    it('handles missing workspace gracefully', async () => {
      vi.doMock('vscode', () => ({
        workspace: { workspaceFolders: [] },
      }));

      const newProvider = new DashboardProvider('/fake/ext', mockContext);
      await newProvider['updateProjectMetrics']();

      const data = (newProvider as any).data;
      expect(data.project.totalFiles).toBe(0);
    });
  });

  describe('updateQualityMetrics', () => {
    it('loads quality stats from tracker', async () => {
      await provider['updateQualityMetrics']();

      const data = (provider as any).data;
      expect(data.quality).toBeDefined();
      expect(data.quality.averageScore).toBe(75.5);
      expect(data.quality.trend).toBe(5);
      expect(data.quality.topCategory).toBe('refactor');
      expect(data.quality.bottomCategory).toBe('test');
      expect(data.quality.totalResponses).toBe(2);
    });
  });

  describe('updateBugMetrics', () => {
    it('scans files and calculates bug risk', async () => {
      await provider['updateBugMetrics']();

      const data = (provider as any).data;
      expect(data.bugs).toBeDefined();
      expect(data.bugs.riskScore).toBe(40);
      expect(data.bugs.critical).toBe(1);
      expect(data.bugs.warning).toBe(2);
    });
  });

  describe('updatePerformanceMetrics', () => {
    it('initializes performance metrics', async () => {
      await provider['updatePerformanceMetrics']();

      const data = (provider as any).data;
      expect(data.performance).toBeDefined();
      expect(data.performance.critical).toBe(0);
      expect(data.performance.warning).toBe(0);
    });
  });

  describe('scanBugs', () => {
    it('analyzes active editor and updates bug metrics', async () => {
      vi.doMock('vscode', () => ({
        window: {
          activeTextEditor: {
            document: {
              getText: () => 'const apiKey = "secret";',
              languageId: 'typescript',
            },
          },
        },
      }));

      const newProvider = new DashboardProvider('/fake/ext', mockContext);
      await newProvider['scanBugs']();

      const data = (newProvider as any).data;
      expect(data.bugs.lastScan).toBeDefined();
    });
  });

  describe('scanPerformance', () => {
    it('analyzes active editor and updates performance metrics', async () => {
      vi.doMock('vscode', () => ({
        window: {
          activeTextEditor: {
            document: {
              getText: () => 'for (let i = 0; i < 10; i++) { for (let j = 0; j < 10; j++) {} }',
              languageId: 'typescript',
            },
          },
        },
      }));

      const newProvider = new DashboardProvider('/fake/ext', mockContext);
      await newProvider['scanPerformance']();

      const data = (newProvider as any).data;
      expect(data.performance.warning).toBeGreaterThanOrEqual(1);
    });
  });

  describe('getHtmlContent', () => {
    it('generates HTML with all metric cards', () => {
      (provider as any).data = {
        project: {
          totalFiles: 100,
          linesOfCode: 5000,
          avgComplexity: 10,
          testsFound: 20,
          docCoverage: 80,
          languages: { ts: 80, js: 20 },
          lastAnalyzed: '2024-01-01',
        },
        quality: {
          averageScore: 85,
          trend: 5,
          topCategory: 'refactor',
          bottomCategory: 'test',
          totalResponses: 50,
        },
        bugs: {
          critical: 0,
          warning: 2,
          info: 1,
          riskScore: 15,
          lastScan: '2024-01-01',
        },
        performance: {
          critical: 0,
          warning: 1,
          issues: ['Nested loops'],
        },
      };

      const html = provider['getHtmlContent']();
      expect(html).toContain('Local AI Quality Dashboard');
      expect(html).toContain('100'); // totalFiles
      expect(html).toContain('85'); // averageScore
      expect(html).toContain('15'); // riskScore
      expect(html).toContain('ts: 80');
    });

    it('shows loading state when no data', () => {
      (provider as any).data = null;
      const html = provider['getHtmlContent']();
      expect(html).toContain('Carregando dashboard');
    });
  });

  describe('risk color calculation', () => {
    it('uses red for critical risk', () => {
      (provider as any).data = {
        project: { totalFiles: 10, linesOfCode: 100, avgComplexity: 5, testsFound: 2, docCoverage: 50, languages: {}, lastAnalyzed: '' },
        quality: { averageScore: 50, trend: 0, topCategory: '', bottomCategory: '', totalResponses: 0 },
        bugs: { critical: 5, warning: 0, info: 0, riskScore: 85, lastScan: '' },
        performance: { critical: 0, warning: 0, issues: [] },
      };

      const html = provider['getHtmlContent']();
      expect(html).toContain('#ff4444');
    });

    it('uses orange for high risk', () => {
      (provider as any).data = {
        project: { totalFiles: 10, linesOfCode: 100, avgComplexity: 5, testsFound: 2, docCoverage: 50, languages: {}, lastAnalyzed: '' },
        quality: { averageScore: 50, trend: 0, topCategory: '', bottomCategory: '', totalResponses: 0 },
        bugs: { critical: 0, warning: 3, info: 0, riskScore: 60, lastScan: '' },
        performance: { critical: 0, warning: 0, issues: [] },
      };

      const html = provider['getHtmlContent']();
      expect(html).toContain('#ffaa00');
    });

    it('uses green for low risk', () => {
      (provider as any).data = {
        project: { totalFiles: 10, linesOfCode: 100, avgComplexity: 5, testsFound: 2, docCoverage: 50, languages: {}, lastAnalyzed: '' },
        quality: { averageScore: 50, trend: 0, topCategory: '', bottomCategory: '', totalResponses: 0 },
        bugs: { critical: 0, warning: 0, info: 1, riskScore: 15, lastScan: '' },
        performance: { critical: 0, warning: 0, issues: [] },
      };

      const html = provider['getHtmlContent']();
      expect(html).toContain('#4ec9b0');
    });
  });
});