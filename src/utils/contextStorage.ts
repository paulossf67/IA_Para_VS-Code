import * as vscode from 'vscode';

export interface SelectedFilesConfig {
  included: string[];
  excluded: string[];
}

const STORAGE_KEY = 'localAI_selectedFiles';

/**
 * @deprecated Use AdvancedContextManager instead.
 * Kept for backward compatibility with existing commands.
 */
export function getSelectedFilesConfig(storage: vscode.Memento): SelectedFilesConfig | null {
  return storage.get<SelectedFilesConfig>(STORAGE_KEY) ?? null;
}

/**
 * @deprecated Use AdvancedContextManager instead.
 */
export async function clearSelectedFiles(storage: vscode.Memento): Promise<void> {
  await storage.update(STORAGE_KEY, undefined);
}