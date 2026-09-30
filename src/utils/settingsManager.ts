import * as vscode from 'vscode';
import { AdvancedContextManager } from './advancedContextManager';
import { SnippetManager } from './snippetManager';
import { SemanticSearcher } from './semanticSearch';

export interface ExportableSettings {
  version: number;
  timestamp: string;
  configuration: Record<string, unknown>;
  contextGroups: {
    groups: import('./advancedContextManager').ContextGroup[];
    selectedGroupId: string | null;
    autoDetectGroups: boolean;
  };
  snippets: import('./snippetManager').AISnippet[];
  semanticSearch: {
    embeddingModel: string;
    similarityThreshold: number;
    index: import('./semanticSearch').SearchableItem[];
  };
}

const SETTINGS_STORAGE_KEY = 'local-ai.exportedSettings';

export class SettingsManager {
  constructor(
    private context: vscode.ExtensionContext,
    private storage: vscode.Memento,
    private secrets: vscode.SecretStorage
  ) {}

  /** Exporta todas as configurações para um arquivo JSON */
  async exportToFile(): Promise<void> {
    const settings = await this.gatherSettings();
    
    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`local-ai-settings-${new Date().toISOString().split('T')[0]}.json`),
      filters: { 'JSON': ['json'] },
    });
    
    if (!uri) return;
    
    const content = JSON.stringify(settings, null, 2);
    await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));
    
    vscode.window.showInformationMessage(`Configurações exportadas para ${uri.fsPath}`);
  }

  /** Importa configurações de um arquivo JSON */
  async importFromFile(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: { 'JSON': ['json'] },
      openLabel: 'Importar configurações',
    });
    
    if (!uris || uris.length === 0) return;
    
    try {
      const content = await vscode.workspace.fs.readFile(uris[0]);
      const settings: ExportableSettings = JSON.parse(Buffer.from(content).toString('utf-8'));
      
      // Validação básica
      if (!settings.version || settings.version > 1) {
        throw new Error('Versão de configuração não suportada');
      }
      
      await this.applySettings(settings);
      vscode.window.showInformationMessage('Configurações importadas com sucesso! Reinicie a extensão para aplicar todas as mudanças.');
    } catch (err: any) {
      vscode.window.showErrorMessage(`Falha ao importar: ${err.message}`);
    }
  }

  /** Gera um backup automático das configurações atuais */
  async createBackup(): Promise<void> {
    const settings = await this.gatherSettings();
    await this.storage.update(SETTINGS_STORAGE_KEY, settings);
    vscode.window.showInformationMessage('Backup das configurações criado');
  }

  /** Restaura o último backup */
  async restoreBackup(): Promise<void> {
    const backup = this.storage.get<ExportableSettings>(SETTINGS_STORAGE_KEY);
    if (!backup) {
      vscode.window.showWarningMessage('Nenhum backup encontrado');
      return;
    }
    
    const confirm = await vscode.window.showWarningMessage(
      'Isso substituirá todas as configurações atuais. Continuar?',
      { modal: true },
      'Sim, restaurar'
    );
    
    if (confirm !== 'Sim, restaurar') return;
    
    await this.applySettings(backup);
    vscode.window.showInformationMessage('Backup restaurado! Reinicie a extensão.');
  }

  private async gatherSettings(): Promise<ExportableSettings> {
    // Configuração do VS Code (local-ai.*)
    const config = vscode.workspace.getConfiguration('local-ai');
    const configKeys = [
      'ollamaUrl', 'model', 'enableInlineCompletion', 'inlineCompletionDelay',
      'maxTokens', 'temperature', 'numCtx', 'maxHistoryMessages', 'maxHistorySize',
      'enableAutoReview', 'enableDashboard', 'aiProvider',
      'enableSemanticSearch', 'embeddingModel', 'similarityThreshold'
    ];
    
    const configuration: Record<string, unknown> = {};
    for (const key of configKeys) {
      const value = config.get(key);
      if (value !== undefined) configuration[key] = value;
    }

    // Context Groups
    const contextManager = new AdvancedContextManager(this.storage);
    const contextConfig = await contextManager.loadConfig();

    // Snippets
    const snippetManager = new SnippetManager(this.storage, this.context.globalStorageUri.fsPath);
    const snippets = await snippetManager.loadSnippets();

    // Semantic Search
    const searcher = new SemanticSearcher(this.storage, this.context);
    await searcher.initialize();
    const searchConfig = vscode.workspace.getConfiguration('local-ai');
    
    return {
      version: 1,
      timestamp: new Date().toISOString(),
      configuration,
      contextGroups: contextConfig,
      snippets,
      semanticSearch: {
        embeddingModel: searchConfig.get<string>('embeddingModel', 'nomic-embed-text'),
        similarityThreshold: searchConfig.get<number>('similarityThreshold', 0.3),
        index: (searcher as any).index || [],
      },
    };
  }

  private async applySettings(settings: ExportableSettings): Promise<void> {
    // 1. Configuração do VS Code
    const config = vscode.workspace.getConfiguration('local-ai');
    for (const [key, value] of Object.entries(settings.configuration)) {
      await config.update(key, value, vscode.ConfigurationTarget.Global);
    }

    // 2. Context Groups
    const contextManager = new AdvancedContextManager(this.storage);
    await contextManager.saveConfig(settings.contextGroups);

    // 3. Snippets
    const snippetManager = new SnippetManager(this.storage, this.context.globalStorageUri.fsPath);
    for (const snippet of settings.snippets) {
      await snippetManager.saveSnippet(snippet);
    }

    // 4. Semantic Search Index
    const searcher = new SemanticSearcher(this.storage, this.context);
    await searcher.initialize();
    if (settings.semanticSearch.index?.length) {
      (searcher as any).index = settings.semanticSearch.index;
      await searcher.persist();
    }

    // 5. Config de busca semântica
    const searchConfig = vscode.workspace.getConfiguration('local-ai');
    await searchConfig.update('embeddingModel', settings.semanticSearch.embeddingModel, vscode.ConfigurationTarget.Global);
    await searchConfig.update('similarityThreshold', settings.semanticSearch.similarityThreshold, vscode.ConfigurationTarget.Global);
  }
}

/** Comando para exportar configurações */
export async function exportSettings(context: vscode.ExtensionContext): Promise<void> {
  const manager = new SettingsManager(context, context.globalState, context.secrets);
  await manager.exportToFile();
}

/** Comando para importar configurações */
export async function importSettings(context: vscode.ExtensionContext): Promise<void> {
  const manager = new SettingsManager(context, context.globalState, context.secrets);
  await manager.importFromFile();
}

/** Comando para criar backup */
export async function backupSettings(context: vscode.ExtensionContext): Promise<void> {
  const manager = new SettingsManager(context, context.globalState, context.secrets);
  await manager.createBackup();
}

/** Comando para restaurar backup */
export async function restoreSettingsBackup(context: vscode.ExtensionContext): Promise<void> {
  const manager = new SettingsManager(context, context.globalState, context.secrets);
  await manager.restoreBackup();
}