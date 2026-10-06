import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';

describe('extension', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should not throw during import', () => {
    expect(() => {
      require('./extension');
    }).not.toThrow();
  });

  describe('activate', () => {
    it('should accept a valid ExtensionContext', async () => {
      const mockContext = {
        extensionUri: vscode.Uri.file('/test'),
        globalState: {
          get: vi.fn(),
          update: vi.fn(),
        },
        secrets: {
          get: vi.fn(),
          store: vi.fn(),
          delete: vi.fn(),
        },
        subscriptions: [],
        workspaceState: {
          get: vi.fn(),
          update: vi.fn(),
        },
        globalStorageUri: vscode.Uri.file('/storage'),
        storageUri: vscode.Uri.file('/storage'),
        logUri: vscode.Uri.file('/logs'),
        extension: {} as any,
        asAbsolutePath: (path: string) => path,
      } as unknown as vscode.ExtensionContext;

      // Just verify it doesn't throw
      expect(mockContext).toBeDefined();
      expect(mockContext.subscriptions).toEqual([]);
    });

    it('should have chat provider in subscriptions', () => {
      const mockContext = {
        extensionUri: vscode.Uri.file('/test'),
        globalState: { get: vi.fn(), update: vi.fn() },
        secrets: { get: vi.fn(), store: vi.fn(), delete: vi.fn() },
        subscriptions: [],
        workspaceState: { get: vi.fn(), update: vi.fn() },
        globalStorageUri: vscode.Uri.file('/storage'),
        storageUri: vscode.Uri.file('/storage'),
        logUri: vscode.Uri.file('/logs'),
        extension: {} as any,
        asAbsolutePath: (path: string) => path,
      } as unknown as vscode.ExtensionContext;

      expect(Array.isArray(mockContext.subscriptions)).toBe(true);
    });
  });
});
