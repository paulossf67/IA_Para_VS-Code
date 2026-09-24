import * as vscode from 'vscode';
import { ChatViewProvider } from './chat/ChatPanel';
import { LocalAIInlineCompletionProvider } from './completion/InlineCompletionProvider';
import { registerCommands } from './commands';
import { checkOllamaAvailable, getConfig, isModelInstalled, listModels } from './utils/ollama';

export function activate(context: vscode.ExtensionContext) {
  console.log('Local AI Assistant ativado!');

  // Provider do chat (webview na activity bar)
  const chatProvider = new ChatViewProvider(context.extensionUri, context.globalState);

  context.subscriptions.push(
    chatProvider,
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatProvider, {
      // Mantém a conversa na tela ao esconder/mostrar o painel
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  // Comandos
  registerCommands(context, chatProvider, context.globalState);

  // Inline Completion (autocomplete) só em arquivos de verdade
  // (evita disparar no painel de Output, no git, etc.)
  const inlineProvider = new LocalAIInlineCompletionProvider();
  context.subscriptions.push(
    vscode.languages.registerInlineCompletionItemProvider(
      [{ scheme: 'file' }, { scheme: 'untitled' }],
      inlineProvider
    )
  );

  // Verifica Ollama e modelo pouco depois de iniciar
  setTimeout(() => void checkSetup(), 2000);
}

async function checkSetup() {
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
    const action = await vscode.window.showWarningMessage(
      `Local AI: o modelo "${model}" não está instalado. Rode "ollama pull ${model}" ou escolha um dos modelos instalados.`,
      'Escolher modelo'
    );
    if (action === 'Escolher modelo') {
      vscode.commands.executeCommand('local-ai.selectModel');
    }
  }
}

export function deactivate() {}
