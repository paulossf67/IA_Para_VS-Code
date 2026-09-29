import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

describe('gitIntegration', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    const repo = {
      rootUri: vscode.Uri.file('C:/repo'),
      diffIndexWithHEAD: vi.fn().mockResolvedValue('diff --git a/file.txt b/file.txt\n+hello'),
    };

    Object.defineProperty(vscode, 'extensions', {
      value: {
        getExtension: vi.fn().mockReturnValue({
          isActive: true,
          exports: {
            getAPI: vi.fn().mockReturnValue({ repositories: [repo] }),
          },
        }),
      },
      configurable: true,
    });

    (vscode.window as any).showWarningMessage = vi.fn();
    (vscode.window as any).showErrorMessage = vi.fn();
    (vscode.window as any).showInformationMessage = vi.fn();
  });

  it('refreshes the git api when a fresh diff is requested', async () => {
    const { getWorkspaceGitDiff } = await import('./gitIntegration');

    const result = await getWorkspaceGitDiff(vscode.Uri.file('C:/repo/src/app.ts'));

    expect(result).toContain('### Diff Git do repositório ativo');
    expect(result).toContain('diff --git');
    const gitExt = (vscode as any).extensions.getExtension.mock.results[0].value;
    expect(gitExt.exports.getAPI).toHaveBeenCalledWith(1);
  });
});
