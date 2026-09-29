import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

describe('gitIntegration', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    Object.defineProperty(vscode, 'extensions', {
      value: {
        getExtension: vi.fn().mockReturnValue({
          isActive: true,
          exports: {
            getAPI: vi.fn().mockReturnValue({ repositories: [] }),
          },
        }),
      },
      configurable: true,
    });

    (vscode.window as any).showWarningMessage = vi.fn();
    (vscode.window as any).showErrorMessage = vi.fn();
    (vscode.window as any).showInformationMessage = vi.fn();
  });

  it('accepts the refresh flag without throwing when Git is unavailable', async () => {
    const { getWorkspaceGitDiff } = await import('./gitIntegration');

    await expect(getWorkspaceGitDiff(vscode.Uri.file('C:/repo/src/app.ts'))).resolves.toBeNull();
  });
});
