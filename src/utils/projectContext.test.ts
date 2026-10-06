import { describe, it, expect, beforeEach } from 'vitest';
import { clearContextCache } from './projectContext';

describe('projectContext', () => {
  describe('clearContextCache', () => {
    it('should not throw when called', () => {
      expect(() => clearContextCache()).not.toThrow();
    });

    it('should be callable multiple times', () => {
      clearContextCache();
      clearContextCache();
      clearContextCache();
      expect(true).toBe(true);
    });
  });
});
