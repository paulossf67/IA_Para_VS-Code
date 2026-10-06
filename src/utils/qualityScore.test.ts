import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QualityScoreTracker, ResponseMetrics, getQualityIndicator } from './qualityScore';
import * as vscode from 'vscode';

describe('QualityScoreTracker', () => {
  let tracker: QualityScoreTracker;
  let mockStorage: Record<string, unknown> = {};

  const mockMemento = {
    get: (key: string) => mockStorage[key],
    update: async (key: string, value: unknown) => {
      mockStorage[key] = value;
    },
    keys: () => Object.keys(mockStorage),
  } as vscode.Memento;

  beforeEach(() => {
    mockStorage = {};
    tracker = new QualityScoreTracker(mockMemento);
  });

  describe('recordResponse', () => {
    it('should record a response with auto-generated ID and timestamp', async () => {
      const metric = await tracker.recordResponse({
        category: 'explanation',
        autoScore: 80,
        readability: 85,
        relevance: 90,
        completeness: 75,
        timeToGenerate: 1500,
      });

      expect(metric.responseId).toMatch(/^resp-\d+-[a-z0-9]{7}$/);
      expect(metric.timestamp).toBeInstanceOf(Date);
      expect(metric.category).toBe('explanation');
      expect(metric.autoScore).toBe(80);
    });

    it('should keep only last MAX_METRICS records', async () => {
      for (let i = 0; i < 1005; i++) {
        await tracker.recordResponse({
          category: 'test',
          autoScore: 50,
          readability: 50,
          relevance: 50,
          completeness: 50,
          timeToGenerate: 100,
        });
      }

      const metrics = await tracker.loadMetrics();
      expect(metrics.length).toBe(1000);
    });

    it('should allow optional user rating and production flag', async () => {
      const metric = await tracker.recordResponse({
        category: 'refactor',
        autoScore: 75,
        userRating: 4,
        usedInProduction: true,
        readability: 80,
        relevance: 75,
        completeness: 70,
        timeToGenerate: 2000,
      });

      expect(metric.userRating).toBe(4);
      expect(metric.usedInProduction).toBe(true);
    });
  });

  describe('rateResponse', () => {
    it('should update rating for existing response', async () => {
      const metric = await tracker.recordResponse({
        category: 'explanation',
        autoScore: 60,
        readability: 60,
        relevance: 60,
        completeness: 60,
        timeToGenerate: 1000,
      });

      await tracker.rateResponse(metric.responseId, 5);

      const updated = await tracker.loadMetrics();
      const found = updated.find((m) => m.responseId === metric.responseId);
      expect(found?.userRating).toBe(5);
    });

    it('should ignore rating for non-existent response', async () => {
      await tracker.rateResponse('non-existent-id', 3);
      const metrics = await tracker.loadMetrics();
      expect(metrics.length).toBe(0);
    });
  });

  describe('getWeeklyStats', () => {
    it('should return zero stats when no metrics exist', async () => {
      const stats = await tracker.getWeeklyStats();
      expect(stats.averageScore).toBe(0);
      expect(stats.trend).toBe(0);
      expect(stats.topCategory).toBe('');
      expect(stats.bottomCategory).toBe('');
    });

    it('should calculate average score for weekly metrics', async () => {
      const now = Date.now();
      mockStorage['local-ai.responseMetrics'] = [
        {
          responseId: 'r1',
          timestamp: new Date(now),
          category: 'test',
          autoScore: 60,
          readability: 60,
          relevance: 60,
          completeness: 60,
          timeToGenerate: 100,
        },
        {
          responseId: 'r2',
          timestamp: new Date(now),
          category: 'test',
          autoScore: 80,
          readability: 80,
          relevance: 80,
          completeness: 80,
          timeToGenerate: 100,
        },
      ];

      const stats = await tracker.getWeeklyStats();
      expect(stats.averageScore).toBe(70);
    });

    it('should identify top and bottom categories', async () => {
      const now = Date.now();
      mockStorage['local-ai.responseMetrics'] = [
        {
          responseId: 'r1',
          timestamp: new Date(now),
          category: 'explanation',
          autoScore: 90,
          readability: 90,
          relevance: 90,
          completeness: 90,
          timeToGenerate: 100,
        },
        {
          responseId: 'r2',
          timestamp: new Date(now),
          category: 'refactor',
          autoScore: 30,
          readability: 30,
          relevance: 30,
          completeness: 30,
          timeToGenerate: 100,
        },
      ];

      const stats = await tracker.getWeeklyStats();
      expect(stats.topCategory).toBe('explanation');
      expect(stats.bottomCategory).toBe('refactor');
    });
  });

  describe('getCategoryStats', () => {
    it('should return zero stats for non-existent category', async () => {
      const stats = await tracker.getCategoryStats('nonexistent');
      expect(stats.count).toBe(0);
      expect(stats.averageScore).toBe(0);
      expect(stats.averageRating).toBe(0);
    });

    it('should calculate stats for category with ratings', async () => {
      mockStorage['local-ai.responseMetrics'] = [
        {
          responseId: 'r1',
          timestamp: new Date(),
          category: 'test',
          autoScore: 50,
          userRating: 3,
          readability: 50,
          relevance: 50,
          completeness: 50,
          timeToGenerate: 100,
        },
        {
          responseId: 'r2',
          timestamp: new Date(),
          category: 'test',
          autoScore: 80,
          userRating: 5,
          readability: 80,
          relevance: 80,
          completeness: 80,
          timeToGenerate: 100,
        },
      ];

      const stats = await tracker.getCategoryStats('test');
      expect(stats.count).toBe(2);
      expect(stats.averageScore).toBe(65);
      expect(stats.averageRating).toBe(4);
    });
  });

  describe('autoEvaluateResponse', () => {
    it('should score short responses lower', () => {
      const score = tracker.autoEvaluateResponse('short', 'explanation');
      expect(score).toBeLessThan(50);
    });

    it('should score responses with code examples higher', () => {
      const withCode = tracker.autoEvaluateResponse(
        'Here is an example:\n```javascript\nconst x = 1;\n```',
        'explanation'
      );
      const withoutCode = tracker.autoEvaluateResponse('Here is an example with text only.', 'explanation');
      expect(withCode).toBeGreaterThan(withoutCode);
    });

    it('should give explanation bonus for explanatory phrases', () => {
      const explanation = tracker.autoEvaluateResponse(
        'This works because we need to initialize the variable. Therefore, the code is correct.'.repeat(5),
        'explanation'
      );
      expect(explanation).toBeGreaterThan(50);
    });

    it('should clamp score between 0 and 100', () => {
      const veryLong = 'x'.repeat(10000);
      const score = tracker.autoEvaluateResponse(veryLong, 'test');
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });
  });

  describe('showDashboard', () => {
    it('should call vscode.window.showInformationMessage', async () => {
      const showInfoSpy = vi.spyOn(vscode.window, 'showInformationMessage');
      await tracker.showDashboard();
      expect(showInfoSpy).toHaveBeenCalled();
    });
  });

  describe('getQualityIndicator', () => {
    it('should return 5 stars for score >= 90', () => {
      expect(getQualityIndicator(95)).toBe('⭐⭐⭐⭐⭐');
      expect(getQualityIndicator(100)).toBe('⭐⭐⭐⭐⭐');
    });

    it('should return 4 stars for score >= 80', () => {
      expect(getQualityIndicator(85)).toBe('⭐⭐⭐⭐');
      expect(getQualityIndicator(80)).toBe('⭐⭐⭐⭐');
    });

    it('should return 3 stars for score >= 70', () => {
      expect(getQualityIndicator(75)).toBe('⭐⭐⭐');
    });

    it('should return error indicator for low scores', () => {
      expect(getQualityIndicator(30)).toBe('❌');
      expect(getQualityIndicator(0)).toBe('❌');
    });
  });
});
