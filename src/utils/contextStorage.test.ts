import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getSelectedFilesConfig, clearSelectedFiles, SelectedFilesConfig } from './contextStorage';
import * as vscode from 'vscode';

describe('contextStorage', () => {
  let mockStorage: Record<string, unknown> = {};

  const mockMemento = {
    get: (key: string) => mockStorage[key],
    update: async (key: string, value: unknown) => {
      mockStorage[key] = value;
      return undefined;
    },
    keys: () => Object.keys(mockStorage),
  } as vscode.Memento;

  beforeEach(() => {
    mockStorage = {};
  });

  afterEach(() => {
    vi.clearAllMocks();
    mockStorage = {};
  });

  describe('getSelectedFilesConfig', () => {
    it('should return null when no config is stored', () => {
      const config = getSelectedFilesConfig(mockMemento);
      expect(config).toBeNull();
    });

    it('should return stored config when it exists', () => {
      const testConfig: SelectedFilesConfig = {
        included: ['src/**/*.ts', 'tests/**/*.ts'],
        excluded: ['node_modules/**', 'dist/**'],
      };
      mockStorage['localAI_selectedFiles'] = testConfig;

      const config = getSelectedFilesConfig(mockMemento);
      expect(config).toEqual(testConfig);
      expect(config?.included).toHaveLength(2);
      expect(config?.excluded).toHaveLength(2);
    });

    it('should handle empty arrays in config', () => {
      const testConfig: SelectedFilesConfig = {
        included: [],
        excluded: [],
      };
      mockStorage['localAI_selectedFiles'] = testConfig;

      const config = getSelectedFilesConfig(mockMemento);
      expect(config?.included).toHaveLength(0);
      expect(config?.excluded).toHaveLength(0);
    });
  });

  describe('clearSelectedFiles', () => {
    it('should clear stored config', async () => {
      mockStorage['localAI_selectedFiles'] = {
        included: ['src/**/*.ts'],
        excluded: ['node_modules/**'],
      };

      await clearSelectedFiles(mockMemento);

      expect(mockStorage['localAI_selectedFiles']).toBeUndefined();
    });

    it('should work when no config exists', async () => {
      await expect(clearSelectedFiles(mockMemento)).resolves.not.toThrow();
    });

    it('should return null after clearing', async () => {
      mockStorage['localAI_selectedFiles'] = {
        included: ['src/**/*.ts'],
        excluded: [],
      };

      await clearSelectedFiles(mockMemento);

      const config = getSelectedFilesConfig(mockMemento);
      expect(config).toBeNull();
    });
  });
});
