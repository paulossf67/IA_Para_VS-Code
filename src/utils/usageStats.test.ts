import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UsageStatsTracker } from './usageStats';

vi.mock('vscode', () => ({
  Memento: class {
    private store = new Map();
    get(key: string, defaultValue?: any) { return this.store.get(key) ?? defaultValue; }
    update(key: string, value: any) { this.store.set(key, value); return Promise.resolve(); }
  },
}));

describe('UsageStatsTracker', () => {
  let tracker: UsageStatsTracker;
  let mockStorage: any;

  beforeEach(() => {
    mockStorage = {
      store: new Map(),
      get: vi.fn((key: string, defaultValue?: any) => mockStorage.store.get(key) ?? defaultValue),
      update: vi.fn((key: string, value: any) => { mockStorage.store.set(key, value); return Promise.resolve(); }),
    };
    tracker = new UsageStatsTracker(mockStorage);
  });

  describe('initialize', () => {
    it('initializes with empty stats', async () => {
      await tracker.initialize();
      const stats = tracker.getStats();
      
      expect(stats.totalTokens).toBe(0);
      expect(stats.totalRequests).toBe(0);
      expect(stats.totalCost).toBe(0);
    });

    it('loads saved stats', async () => {
      const savedStats = {
        totalTokens: 1000,
        totalRequests: 10,
        totalCost: 0.05,
        byModel: { 'qwen2.5-coder': { tokens: 1000, requests: 10, cost: 0.05 } },
        byCategory: { chat: { tokens: 500, requests: 5 } },
        daily: { '2024-01-15': { tokens: 500, requests: 5 } },
        lastUpdated: '2024-01-15T10:00:00.000Z',
      };
      mockStorage.store.set('local-ai.usageStats', { stats: savedStats, events: [] });

      await tracker.initialize();
      const stats = tracker.getStats();
      
      expect(stats.totalTokens).toBe(1000);
      expect(stats.totalRequests).toBe(10);
    });
  });

  describe('recordEvent', () => {
    it('records event and updates stats', async () => {
      await tracker.initialize();
      
      await tracker.recordEvent({
        model: 'qwen2.5-coder',
        category: 'chat',
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        durationMs: 1000,
        success: true,
      });

      const stats = tracker.getStats();
      expect(stats.totalTokens).toBe(150);
      expect(stats.totalRequests).toBe(1);
      expect(stats.byModel['qwen2.5-coder']).toEqual({ tokens: 150, requests: 1, cost: 0 });
      expect(stats.byCategory['chat']).toEqual({ tokens: 150, requests: 1 });
    });

    it('aggregates by date', async () => {
      await tracker.initialize();
      
      await tracker.recordEvent({
        model: 'test',
        category: 'chat',
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        durationMs: 100,
        success: true,
      });

      const stats = tracker.getStats();
      const today = new Date().toISOString().split('T')[0];
      expect(stats.daily[today]).toBeDefined();
      expect(stats.daily[today]?.tokens).toBe(150);
    });
  });

  describe('getEvents', () => {
    it('returns events in reverse chronological order', async () => {
      await tracker.initialize();
      
      await tracker.recordEvent({ model: 'a', category: 'chat', promptTokens: 10, completionTokens: 5, totalTokens: 15, durationMs: 100, success: true });
      await tracker.recordEvent({ model: 'b', category: 'chat', promptTokens: 20, completionTokens: 10, totalTokens: 30, durationMs: 200, success: true });
      
      const events = tracker.getEvents();
      expect(events[0].model).toBe('b');
      expect(events[1].model).toBe('a');
    });

    it('limits number of events', async () => {
      await tracker.initialize();
      
      for (let i = 0; i < 150; i++) {
        await tracker.recordEvent({ model: `m${i}`, category: 'chat', promptTokens: 10, completionTokens: 5, totalTokens: 15, durationMs: 100, success: true });
      }
      
      const events = tracker.getEvents(50);
      expect(events.length).toBe(50);
    });
  });

  describe('clearHistory', () => {
    it('clears all stats and events', async () => {
      await tracker.initialize();
      await tracker.recordEvent({ model: 'test', category: 'chat', promptTokens: 10, completionTokens: 5, totalTokens: 15, durationMs: 100, success: true });
      
      await tracker.clearHistory();
      
      const stats = tracker.getStats();
      expect(stats.totalTokens).toBe(0);
      expect(stats.totalRequests).toBe(0);
      expect(tracker.getEvents().length).toBe(0);
    });
  });

  describe('export/import', () => {
    it('exports data as JSON', async () => {
      await tracker.initialize();
      await tracker.recordEvent({ model: 'test', category: 'chat', promptTokens: 10, completionTokens: 5, totalTokens: 15, durationMs: 100, success: true });
      
      const json = await tracker.exportData();
      const data = JSON.parse(json);
      
      expect(data.stats).toBeDefined();
      expect(data.events).toBeDefined();
      expect(data.events.length).toBe(1);
    });

    it('imports data', async () => {
      await tracker.initialize();
      
      const importData = {
        stats: { totalTokens: 500, totalRequests: 5, totalCost: 0, byModel: {}, byCategory: {}, daily: {}, lastUpdated: new Date().toISOString() },
        events: [{ model: 'imported', category: 'chat', promptTokens: 10, completionTokens: 5, totalTokens: 15, durationMs: 100, success: true, timestamp: new Date().toISOString() }],
      };
      
      await tracker.importData(JSON.stringify(importData));
      
      const stats = tracker.getStats();
      expect(stats.totalTokens).toBe(500);
      expect(tracker.getEvents().length).toBe(1);
    });
  });
});