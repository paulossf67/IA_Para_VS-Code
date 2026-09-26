import * as vscode from 'vscode';

export interface SelectedFilesConfig {
  included: string[];
  excluded: string[];
}

const STORAGE_KEY = 'localAI_selectedFiles';

export async function selectFilesForContext(storage: vscode.Memento): Promise<SelectedFilesConfig | null> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    vscode.window.showWarningMessage('Local AI: abra um workspace para selecionar arquivos.');
    return null;
  }

  const allFiles = await vscode.workspace.findFiles('**/*', '**/node_modules/**', 100);

  const quickPicks = allFiles.map((file) => ({
    label: vscode.workspace.asRelativePath(file),
    detail: file.fsPath,
    picked: false,
  }));

  if (quickPicks.length === 0) {
    vscode.window.showInformationMessage('Local AI: nenhum arquivo encontrado.');
    return null;
  }

  const selected = await vscode.window.showQuickPick(quickPicks, {
    canPickMany: true,
    placeHolder: 'Selecione arquivos para incluir no context (desmarcar = excluir)',
  });

  if (!selected) return null;

  const included = selected.map((item) => item.label);

  const config: SelectedFilesConfig = {
    included,
    excluded: quickPicks.filter((f) => !selected.includes(f)).map((f) => f.label),
  };

  await storage.update(STORAGE_KEY, config);

  vscode.window.showInformationMessage(
    `Local AI: ${included.length} arquivos selecionados para context.`
  );

  return config;
}

export function getSelectedFilesConfig(storage: vscode.Memento): SelectedFilesConfig | null {
  return storage.get<SelectedFilesConfig>(STORAGE_KEY) ?? null;
}

export async function clearSelectedFiles(storage: vscode.Memento): Promise<void> {
  await storage.update(STORAGE_KEY, undefined);
  vscode.window.showInformationMessage('Local AI: seleção de arquivos limpa.');
}
