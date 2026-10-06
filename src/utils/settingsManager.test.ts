import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SettingsManager, ExportableSettings } from './settingsManager';
import * as vscode from 'vscode';

describe('SettingsManager', () => {
  let manager: SettingsManager;
  let mockContext: Partial<vscode.ExtensionContext>;
  let mockStorage: Record<string, unknown> = {};
  let mockSecrets: Partial<vscode.SecretStorage>;

  beforeEach(() => {
    mockStorage = {};

    const mockMemento = {
      get: (key: string) => mockStorage[key],
      update: async (key: string, value: unknown) => {
        mockStorage[key] = value;
      },
      keys: () => Object.keys(mockStorage),
    } as vscode.Memento;

    mockSecrets = {
      get: vi.fn(),
      store: vi.fn(),
      delete: vi.fn(),
      onDidChange: { fire: vi.fn() } as any,
    };

    mockContext = {
      globalState: mockMemento,
      secrets: mockSecrets as vscode.SecretStorage,
      globalStorageUri: vscode.Uri.file('/tmp/storage'),
    };

    manager = new SettingsManager(
      mockContext as vscode.ExtensionContext,
      mockMemento,
      mockSecrets as vscode.SecretStorage
    );
  });

  describe('createBackup', () => {
    it('should create a backup of current settings', async () => {
      vi.spyOn(vscode.window, 'showInformationMessage').mockResolvedValue('OK' as any);
      vi.spyOn(vscode.workspace, 'getConfiguration').mockReturnValue({
        get: (key: string) => {
          const defaults: Record<string, unknown> = {
            ollamaUrl: 'http://localhost:11434',
            model: 'qwen2.5-coder:7b',
            temperature: 0.2,
          };
          return defaults[key];
        },
        update: vi.fn(),
      } as any);

      await manager.createBackup();

      expect(mockStorage['local-ai.exportedSettings']).toBeDefined();
      const backup = mockStorage['local-ai.exportedSettings'] as ExportableSettings;
      expect(backup.version).toBe(1);
      expect(backup.timestamp).toBeTruthy();
    });
  });

  describe('restoreBackup', () => {
    it('should return early when no backup exists', async () => {
      vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue('OK' as any);

      await manager.restoreBackup();

      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('Nenhum backup encontrado')
      );
    });

    it('should require confirmation before restoring', async () => {
      const testBackup: ExportableSettings = {
        version: 1,
        timestamp: new Date().toISOString(),
        configuration: { model: 'test-model' },
        contextGroups: {
          groups: [],
          selectedGroupId: null,
          autoDetectGroups: false,
        },
        snippets: [],
        semanticSearch: {
          embeddingModel: 'nomic-embed-text',
          similarityThreshold: 0.3,
          index: [],
        },
      };
      mockStorage['local-ai.exportedSettings'] = testBackup;

      vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(undefined);

      await manager.restoreBackup();

      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('substituirá todas as configurações'),
        expect.any(Object),
        expect.stringContaining('restaurar')
      );
    });
  });
});
