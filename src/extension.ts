import * as vscode from 'vscode';
import { ChatViewProvider } from './chat/ChatPanel';
import { LocalAIInlineCompletionProvider } from './completion/InlineCompletionProvider';
import { registerCommands } from './commands';
import { checkOllamaAvailable, getConfig, isModelInstalled, isVisionModel, listModels } from './utils/ollama';
import { analyzeCodeOnSave, disposeDiagnostics, DocumentReviewScheduler } from './utils/autoReview';
import { DashboardProvider } from './utils/dashboardProvider';
import { requiresOllama } from './utils/multiAI';

export function activate(context: vscode.ExtensionContext) {
  console.log('Local AI Assistant ativado!');

  // ✅ FEATURE 1: Chat Provider
  const chatProvider = new ChatViewProvider(
    context.extensionUri,
    context.globalState,
    context.secrets
  );
  (globalThis as any).__localAIChatProvider = chatProvider;
  context.subscriptions.push(
    chatProvider,
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    { dispose: () => { delete (globalThis as any).__localAIChatProvider; } }
  );

  // ✅ FEATURE 2: Dashboard (Analytics)
  const dashboardProvider = new DashboardProvider(context.extensionUri, context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(DashboardProvider.viewType, dashboardProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // ✅ FEATURES 3-8: Commands (Explain, Refactor, Tests, Git, etc)
  registerCommands(context, chatProvider, context.globalState);

  // ✅ FEATURE 9: Auto Code Review (on save)
  // Debounce: salvar em sequência (Ctrl+S repetido, save-all) só dispara uma análise.
  const reviewScheduler = new DocumentReviewScheduler();
  context.subscriptions.push(
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
