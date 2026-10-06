import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { clearContextCache } from './projectContext';

describe('projectContext', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('clearContextCache', () => {
    it('should not throw when called', () => {
      expect(() => clearContextCache()).not.toThrow();
    });

    it('should be callable multiple times', () => {
      expect(() => {
        clearContextCache();
        clearContextCache();
        clearContextCache();
      }).not.toThrow();
    });
  });
});
