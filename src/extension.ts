import * as vscode from 'vscode';
import { ChatViewProvider } from './chat/ChatPanel';
import { LocalAIInlineCompletionProvider } from './completion/InlineCompletionProvider';
import { registerCommands } from './commands';
import { checkOllamaAvailable, getConfig, isModelInstalled, isVisionModel, listModels } from './utils/ollama';
import { analyzeCodeOnSave, CodeReviewActionProvider, disposeDiagnostics, DocumentReviewScheduler, isReviewableDocument } from './utils/autoReview';
import { DashboardProvider } from './utils/dashboardProvider';
import { requiresOllama } from './utils/multiAI';
import { CodePreviewProvider, codePreviewProvider } from './utils/codePreview';
import { ModelManagerProvider } from './utils/modelManagerUI';
import { UsageStatsProvider, UsageStatsTracker, createUsageStatsCommands } from './utils/usageStats';
import { SlashCommandProvider, createSlashCommandCommands, SlashCommandManager } from './utils/slashCommands';
import { OfflineQueueProvider } from './utils/offlineQueue';

export async function activate(context: vscode.ExtensionContext) {
  console.log('Local AI Assistant ativado!');

  // ✅ FEATURE 1: Chat Provider
  const chatProvider = new ChatViewProvider(
    context.extensionUri,
    context.globalState,
    context.secrets
  );
  context.subscriptions.push(
    chatProvider,
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(CodePreviewProvider.scheme, codePreviewProvider),
    vscode.workspace.onDidCloseTextDocument((document) => codePreviewProvider.release(document.uri))
  );

  // ✅ FEATURE 2: Dashboard (Analytics)
  const dashboardProvider = new DashboardProvider(context.extensionUri, context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(DashboardProvider.viewType, dashboardProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // ✅ FEATURE: Model Manager
  const modelManagerProvider = new ModelManagerProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ModelManagerProvider.viewType, modelManagerProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // ✅ FEATURE: Usage Stats
  const usageStatsTracker = new UsageStatsTracker(context.globalState);
  await usageStatsTracker.initialize();
  const usageStatsProvider = new UsageStatsProvider(context.extensionUri, context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(UsageStatsProvider.viewType, usageStatsProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // Register usage stats commands
  createUsageStatsCommands(context, usageStatsTracker);

// ✅ FEATURE: Slash Commands
  const slashCommandProvider = new SlashCommandProvider(context.extensionUri, context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SlashCommandProvider.viewType, slashCommandProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // Register slash commands
  const slashManager = new (await import('./utils/slashCommands')).SlashCommandManager(context.globalState);
  createSlashCommandCommands(context, slashManager);

  // ✅ FEATURE: Offline Queue
  const offlineQueueProvider = new OfflineQueueProvider(context.extensionUri, context.globalState);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(OfflineQueueProvider.viewType, offlineQueueProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // Register offline queue commands
  const offlineQueueManager = new (await import('./utils/offlineQueue')).OfflineQueueManager(context.globalState);
  createOfflineQueueCommands(context, offlineQueueManager);

  // ✅ FEATURES 3-8: Commands (Explain, Refactor, Tests, Git, etc)
  registerCommands(context, chatProvider, context.globalState);

  // ✅ FEATURE 9: Auto Code Review (on save)
  // Debounce: salvar em sequência (Ctrl+S repetido, save-all) só dispara uma análise.
  const reviewScheduler = new DocumentReviewScheduler();
  context.subscriptions.push(
    vscode.commands.registerCommand('local-ai.reviewDocument', (document: vscode.TextDocument) => {
      if (vscode.workspace.getConfiguration('local-ai').get<boolean>('enableAutoReview', true)) {
        void analyzeCodeOnSave(document);
      }
    }),
    vscode.commands.registerCommand('local-ai.reviewCurrentFile', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        void vscode.window.showWarningMessage('Local AI: abra um arquivo de código para revisar.');
        return;
      }
      if (!isReviewableDocument(editor.document)) {
        void vscode.window.showWarningMessage('Local AI: este tipo de arquivo não é compatível com a revisão.');
        return;
      }
      void analyzeCodeOnSave(editor.document, { manual: true });
    }),
    vscode.languages.registerCodeActionsProvider(
      { scheme: 'file' },
      new CodeReviewActionProvider(),
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
    ),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (!vscode.workspace.getConfiguration('local-ai').get<boolean>('enableAutoReview', true)) return;
      const uri = doc.uri.toString();
      reviewScheduler.schedule(uri, 1500, () => {
        if (vscode.workspace.getConfiguration('local-ai').get<boolean>('enableAutoReview', true)) {
          void analyzeCodeOnSave(doc);
        }
      });
    }),
    reviewScheduler
  );

  // ✅ FEATURE 10: Inline Completion (autocomplete)
  const inlineProvider = new LocalAIInlineCompletionProvider();
  context.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider(
      [{ scheme: 'file' }, { scheme: 'untitled' }],
      inlineProvider
    )
  );

  // Verificar setup do Ollama
  const updateDashboardVisibility = () =>
    vscode.commands.executeCommand(
      'setContext',
      'local-ai.dashboardEnabled',
      vscode.workspace.getConfiguration('local-ai').get<boolean>('enableDashboard', true)
    );
  void updateDashboardVisibility();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('local-ai.enableDashboard')) {
        void updateDashboardVisibility();
      }
    })
  );

  const setupTimer = setTimeout(() => {
    void checkSetup(context).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`Local AI: falha ao verificar o Ollama. ${message}`);
    });
  }, 2000);
  context.subscriptions.push({
    dispose: () => {
      clearTimeout(setupTimer);
      disposeDiagnostics();
    },
  });
}

async function checkSetup(context: vscode.ExtensionContext) {
  if (!requiresOllama(context.globalState)) return;

  const available = await checkOllamaAvailable();
  if (!available) {
    const action = await vscode.window.showWarningMessage(
      'Local AI: Ollama não está rodando. A extensão precisa dele para funcionar.',
      'Como instalar',
      'Já instalei'
    );

    if (action === 'Como instalar') {
      vscode.env.openExternal(vscode.Uri.parse('https://ollama.com'));
    } else if (action === 'Já instalei') {
      vscode.window.showInformationMessage(
        'Abra um terminal e rode "ollama serve" (ou abra o app do Ollama). Depois recarregue a janela.'
      );
    }
    return;
  }

  const models = await listModels();
  const { model } = getConfig();

  if (models.length === 0) {
    vscode.window.showWarningMessage(
      `Local AI: nenhum modelo instalado no Ollama. Rode no terminal: ollama pull ${model}`
    );
    return;
  }

  if (!isModelInstalled(model, models)) {
    const suggested = models.find((candidate) => isVisionModel(candidate)) ?? models[0];
    const suggestion = suggested ? ` Sugestão: "${suggested}".` : '';
    const action = await vscode.window.showWarningMessage(
      `Local AI: o modelo "${model}" não está instalado. Rode "ollama pull ${model}" ou escolha um dos modelos instalados.${suggestion}`,
      'Escolher modelo'
    );
    if (action === 'Escolher modelo') {
      vscode.commands.executeCommand('local-ai.selectModel');
    }
  }
}

export function deactivate() {}
