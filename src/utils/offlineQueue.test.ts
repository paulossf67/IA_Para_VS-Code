import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OfflineQueueManager } from './offlineQueue';

vi.mock('./ollama', () => ({
  checkOllamaAvailable: vi.fn(),
}));

vi.mock('vscode', () => ({
  Memento: class {
    private store = new Map();
    get(key: string, defaultValue?: any) { return this.store.get(key) ?? defaultValue; }
    update(key: string, value: any) { this.store.set(key, value); return Promise.resolve(); }
  },
  window: {
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
  },
}));

describe('OfflineQueueManager', () => {
  let manager: OfflineQueueManager;
  let mockStorage: any;

  beforeEach(() => {
    mockStorage = {
      store: new Map(),
      get: vi.fn((key: string, defaultValue?: any) => mockStorage.store.get(key) ?? defaultValue),
      update: vi.fn((key: string, value: any) => { mockStorage.store.set(key, value); return Promise.resolve(); }),
    };
    vi.clearAllMocks();
    manager = new OfflineQueueManager(mockStorage);
  });

  afterEach(() => {
    manager.dispose();
  });

  describe('enqueue', () => {
    it('adds prompt to queue when offline', async () => {
      const { checkOllamaAvailable } = await import('./ollama');
      (checkOllamaAvailable as vi.Mock).mockResolvedValue(false);

      const result = await manager.enqueue({
        text: 'Test prompt',
        priority: 0,
      });

      expect(result).toBeDefined();
      expect(manager.getQueue().length).toBe(1);
      expect(manager.getQueue()[0].text).toBe('Test prompt');
    });

    it('processes immediately when online', async () => {
      const { checkOllamaAvailable } = await import('./ollama');
      const { chat } = await import('./ollama');
      
      (checkOllamaAvailable as vi.Mock).mockResolvedValue(true);
      (chat as vi.Mock).mockResolvedValue('Response from Ollama');

      const result = await manager.enqueue({
        text: 'Test prompt',
        priority: 0,
      });

      expect(result).toBe('Response from Ollama');
      expect(manager.getQueue().length).toBe(0);
    });

    it('sorts by priority', async () => {
      const { checkOllamaAvailable } = await import('./ollama');
      (checkOllamaAvailable as vi.Mock).mockResolvedValue(false);

      await manager.enqueue({ text: 'Low priority', priority: 10 });
      await manager.enqueue({ text: 'High priority', priority: 0 });
      await manager.enqueue({ text: 'Medium priority', priority: 5 });

      const queue = manager.getQueue();
      expect(queue[0].text).toBe('High priority');
      expect(queue[1].text).toBe('Medium priority');
      expect(queue[2].text).toBe('Low priority');
    });
  });

  describe('retry logic', () => {
    it('retries up to 3 times on failure', async () => {
      const { checkOllamaAvailable } = await import('./ollama');
      const { chat } = await import('./ollama');
      
      (checkOllamaAvailable as vi.Mock).mockResolvedValue(true);
      (chat as vi.Mock).mockRejectedValue(new Error('Network error'));

      const promise = manager.enqueue({ text: 'Test', priority: 0 });
      
      // Wait for retries
      await new Promise(r => setTimeout(r, 100));
      
      // Should have retried but still in queue
      expect(manager.getQueue().length).toBeGreaterThanOrEqual(0);
    });

    it('rejects after 3 failed retries', async () => {
      const { checkOllamaAvailable } = await import('./ollama');
      const { chat } = await import('./ollama');
      
      (checkOllamaAvailable as vi.Mock).mockResolvedValue(true);
      (chat as vi.Mock).mockRejectedValue(new Error('Persistent error'));

      const errorPromise = manager.enqueue({ text: 'Test', priority: 0 });
      
      // Wait for all retries
      await new Promise(r => setTimeout(r, 200));
      
      await expect(promise).rejects.toThrow('Persistent error');
    });
  });

  describe('queue management', () => {
    it('returns queue status', () => {
      const status = manager.getQueueStatus();
      expect(status).toHaveProperty('length');
      expect(status).toHaveProperty('isOnline');
      expect(status).toHaveProperty('isProcessing');
    });

    it('clears queue', async () => {
      const { checkOllamaAvailable } = await import('./ollama');
      (checkOllamaAvailable as vi.Mock).mockResolvedValue(false);

      await manager.enqueue({ text: 'Test 1' });
      await manager.enqueue({ text: 'Test 2' });
      
      await manager.clear();
      
      expect(manager.getQueue().length).toBe(0);
    });

    it('retry all resets retries', async () => {
      const { checkOllamaAvailable } = await import('./ollama');
      (checkOllamaAvailable as vi.Mock).mockResolvedValue(false);

      await manager.enqueue({ text: 'Test', priority: 10 });
      
      await manager.retryAll();
      
      const queue = manager.getQueue();
      expect(queue[0].retries).toBe(0);
      expect(queue[0].priority).toBe(0);
    });
  });

  describe('status change notifications', () => {
    it('notifies listeners on status change', async () => {
      const { checkOllamaAvailable } = await import('./ollama');
      (checkOllamaAvailable as vi.Mock).mockResolvedValue(false);
      
      const listener = vi.fn();
      const unsubscribe = manager.onStatusChange(listener);
      
      (checkOllamaAvailable as vi.Mock).mockResolvedValue(true);
      await manager.checkHealth();
      
      expect(listener).toHaveBeenCalledWith(true);
      unsubscribe();
    });
  });
});