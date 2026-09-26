import * as vscode from 'vscode';
import { ChatViewProvider } from '../chat/ChatPanel';
import {
  chat,
  generateFim,
  getConfig,
  listModels,
  checkOllamaAvailable,
  stripCodeFences,
  FimNotSupportedError,
  SYSTEM_PROMPT,
} from '../utils/ollama';
import { getProjectContext } from '../utils/projectContext';
import { getSelectedFilesConfig } from '../utils/contextSelector';
import { migrateFromContextSelector } from '../utils/advancedContextManager';
import { analyzeGitDiff, generateCommitMessage, validateBeforePush } from '../utils/gitIntegration';
import { configureAIProvider } from '../utils/multiAI';
import { AdvancedContextManager, showContextGroupsUI } from '../utils/advancedContextManager';
import { SnippetManager, showSnippetsUI } from '../utils/snippetManager';
import { SemanticSearcher } from '../utils/semanticSearch';
import { CodeGenetics } from '../utils/codeGenetics';

function getSelectedCode(): { code: string; language: string } | null {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('Nenhum editor ativo.');
    return null;
  }

  const selection = editor.selection;
  const code = editor.document.getText(selection);

  if (!code.trim()) {
    vscode.window.showWarningMessage('Selecione algum código primeiro.');
    return null;
  }

  return {
    code,
    language: editor.document.languageId,
  };
}

async function runCodeCommand(
  title: string,
  instruction: string,
  chatProvider: ChatViewProvider
) {
  const selected = getSelectedCode();
  if (!selected) return;

  const prompt = `${instruction}

Linguagem: ${selected.language}

\`\`\`${selected.language}
${selected.code}
\`\`\``;

  await chatProvider.sendPrompt(prompt, title);
}

/** Mostra a lista de modelos instalados no Ollama e salva a escolha nas configurações */
export async function selectModel(): Promise<void> {
  if (!(await checkOllamaAvailable())) {
    vscode.window.showErrorMessage('Local AI: Ollama não está rodando. Rode "ollama serve" e tente de novo.');
    return;
  }

  const models = await listModels();
  if (models.length === 0) {
    const action = await vscode.window.showWarningMessage(
      'Local AI: nenhum modelo instalado no Ollama. Exemplo: ollama pull qwen2.5-coder:7b',
      'Ver modelos'
    );
    if (action === 'Ver modelos') {
      vscode.env.openExternal(vscode.Uri.parse('https://ollama.com/library'));
    }
    return;
  }

  const current = getConfig().model;
  const picked = await vscode.window.showQuickPick(
    models.map((name) => ({
      label: name,
      description: name === current ? '(atual)' : undefined,
    })),
    { placeHolder: `Modelo atual: ${current}. Escolha outro modelo do Ollama` }
  );

  if (picked && picked.label !== current) {
    await vscode.workspace
      .getConfiguration('local-ai')
      .update('model', picked.label, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`Local AI: modelo alterado para ${picked.label}`);
  }
}

export function registerCommands(
  context: vscode.ExtensionContext,
  chatProvider: ChatViewProvider,
  storage?: vscode.Memento
) {
  // Abrir chat
  context.subscriptions.push(
    vscode.commands.registerCommand('local-ai.openChat', () => chatProvider.show())
  );

  // Escolher modelo
  context.subscriptions.push(vscode.commands.registerCommand('local-ai.selectModel', selectModel));

  // Explicar código
  context.subscriptions.push(
    vscode.commands.registerCommand('local-ai.explainCode', () =>
      runCodeCommand(
        'Explicar Código',
        'Explique o código abaixo de forma clara e didática. Diga o que ele faz, como funciona e se há algum ponto de atenção.',
        chatProvider
      )
    )
  );

  // Gerar documentação
  context.subscriptions.push(
    vscode.commands.registerCommand('local-ai.generateDocs', () =>
      runCodeCommand(
        'Gerar Documentação',
        'Gere documentação completa (JSDoc/docstring ou equivalente) para o código abaixo. Inclua descrição, parâmetros, retorno e exemplos se fizer sentido.',
        chatProvider
      )
    )
  );

  // Refatorar
  context.subscriptions.push(
    vscode.commands.registerCommand('local-ai.refactorCode', () =>
      runCodeCommand(
        'Refatorar Código',
        'Refatore o código abaixo para melhorar legibilidade, performance e boas práticas. Mostre o código refatorado e explique as principais mudanças.',
        chatProvider
      )
    )
  );

  // Gerar testes
  context.subscriptions.push(
    vscode.commands.registerCommand('local-ai.generateTests', () =>
      runCodeCommand(
        'Gerar Testes',
        'Gere testes unitários completos para o código abaixo. Use o framework mais comum da linguagem (Jest, pytest, etc). Inclua casos de sucesso e de erro.',
        chatProvider
      )
    )
  );

  // Corrigir código
  context.subscriptions.push(
    vscode.commands.registerCommand('local-ai.fixCode', () =>
      runCodeCommand(
        'Corrigir Código',
        'Analise o código abaixo e corrija possíveis bugs, erros de lógica ou problemas de estilo. Mostre o código corrigido e explique o que estava errado.',
        chatProvider
      )
    )
  );

  // Exportar histórico
  context.subscriptions.push(
    vscode.commands.registerCommand('local-ai.exportHistory', async () => {
      await chatProvider.exportHistory();
    })
  );

  // Limpar histórico
  context.subscriptions.push(
    vscode.commands.registerCommand('local-ai.clearHistory', async () => {
      await chatProvider.clearHistoryWithConfirm();
    })
  );

  // Completar no local do cursor (comando manual)
  context.subscriptions.push(
    vscode.commands.registerCommand('local-ai.completeHere', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('Nenhum editor ativo.');
        return;
      }

      const document = editor.document;
      const position = editor.selection.active;
      const version = document.version;

      const startLine = Math.max(0, position.line - 60);
      const prefix = document.getText(
        new vscode.Range(startLine, 0, position.line, position.character)
      );
      const endLine = Math.min(document.lineCount - 1, position.line + 20);
      const suffix = document.getText(
        new vscode.Range(position, document.lineAt(endLine).range.end)
      );
      const language = document.languageId;

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Local AI está completando...',
          cancellable: true,
        },
        async (_progress, token) => {
          const abort = new AbortController();
          const sub = token.onCancellationRequested(() => abort.abort());
          try {
            let completion: string;
            try {
              completion = await generateFim(prefix, suffix, {
                maxTokens: 300,
                temperature: 0.15,
                signal: abort.signal,
              });
            } catch (err) {
              if (!(err instanceof FimNotSupportedError)) throw err;
              const response = await chat(
                [
                  { role: 'system', content: SYSTEM_PROMPT },
                  {
                    role: 'user',
                    content: `Complete o código a seguir. Retorne APENAS o código a ser inserido, sem markdown e sem explicações.

Linguagem: ${language}

\`\`\`${language}
${prefix}
\`\`\``,
                  },
                ],
                { maxTokens: 300, temperature: 0.15, signal: abort.signal }
              );
              completion = stripCodeFences(response);
            }

            completion = completion.replace(/\s+$/, '');
            if (token.isCancellationRequested || !completion.trim()) return;

            if (document.version !== version) {
              vscode.window.showWarningMessage(
                'Local AI: o arquivo mudou enquanto a sugestão era gerada. Tente de novo.'
              );
              return;
            }

            await editor.edit((editBuilder) => {
              editBuilder.insert(position, completion);
            });
          } catch (err: any) {
            if (err?.name !== 'AbortError') {
              vscode.window.showErrorMessage(`Local AI: ${err.message}`);
            }
          } finally {
            sub.dispose();
          }
        }
      );
    })
  );

  // Selecionar arquivos para context (novo: usa AdvancedContextManager)
  if (storage) {
    context.subscriptions.push(
      vscode.commands.registerCommand('local-ai.selectContextFiles', async () => {
        const manager = new AdvancedContextManager(storage);
        await manager.createGroupFromQuickPick(storage);
      })
    );

    // Limpar seleção de arquivos = remover grupo "Seleção Manual"
    context.subscriptions.push(
      vscode.commands.registerCommand('local-ai.clearContextFiles', async () => {
        const manager = new AdvancedContextManager(storage);
        const config = await manager.loadConfig();
        const manualGroup = config.groups.find(g => g.tags.includes('migrado') || g.name === 'Seleção Manual');
        if (manualGroup) {
          await manager.deleteGroup(manualGroup.id);
          vscode.window.showInformationMessage('Local AI: seleção manual removida');
        } else {
          vscode.window.showInformationMessage('Nenhuma seleção manual para limpar');
        }
      })
    );

    // Migrar seleção antiga (contextSelector) para AdvancedContextManager
    context.subscriptions.push(
      vscode.commands.registerCommand('local-ai.migrateContextSelection', async () => {
        const count = await migrateFromContextSelector(storage);
        if (count > 0) {
          vscode.window.showInformationMessage(`✅ ${count} arquivos migrados para AdvancedContextManager`);
        } else {
          vscode.window.showInformationMessage('Nenhuma seleção antiga para migrar');
        }
      })
    );

    // 🔍 SEMANTIC SEARCH: Indexar projeto
    context.subscriptions.push(
      vscode.commands.registerCommand('local-ai.indexProject', async () => {
        const config = vscode.workspace.getConfiguration('local-ai');
        if (!config.get('enableSemanticSearch', true)) {
          vscode.window.showWarningMessage('Busca semântica desabilitada. Ative em Settings > local-ai.enableSemanticSearch');
          return;
        }

        const searcher = new SemanticSearcher(context.globalState, context);
        await searcher.initialize();

        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'Indexando projeto...', cancellable: true },
          async (progress, token) => {
            token.onCancellationRequested(() => searcher.cancelIndexing());

            // Index chat history
            const chatProvider = (globalThis as any).__localAIChatProvider;
            if (chatProvider && typeof chatProvider.getHistory === 'function') {
              const history = chatProvider.getHistory();
              if (history.length > 0) {
                progress.report({ message: 'Indexando histórico do chat...', increment: 20 });
                await searcher.indexChatHistory(history);
              }
            }

            // Index project files
            progress.report({ message: 'Indexando arquivos do projeto...', increment: 40 });
            await searcher.indexProjectFiles(context.globalState);

            const stats = searcher.getIndexStats();
            vscode.window.showInformationMessage(
              `✅ Indexação completa: ${stats.total} itens (${stats.chat} chat + ${stats.files} arquivos)`
            );
          }
        );
      })
    );

    // 🔍 SEMANTIC SEARCH: Buscar
    context.subscriptions.push(
      vscode.commands.registerCommand('local-ai.semanticSearch', async () => {
        const config = vscode.workspace.getConfiguration('local-ai');
        if (!config.get('enableSemanticSearch', true)) {
          vscode.window.showWarningMessage('Busca semântica desabilitada. Ative em Settings > local-ai.enableSemanticSearch');
          return;
        }

        const searcher = new SemanticSearcher(context.globalState, context);
        await searcher.initialize();

        const stats = searcher.getIndexStats();
        if (stats.total === 0) {
          const action = await vscode.window.showInformationMessage(
            'Índice vazio. Deseja indexar o projeto primeiro?',
            'Indexar agora'
          );
          if (action === 'Indexar agora') {
            await vscode.commands.executeCommand('local-ai.indexProject');
          }
          return;
        }

        await searcher.showSearchUI();
      })
    );

    // 🧬 CODE GENETICS: Evolução do código
    context.subscriptions.push(
      vscode.commands.registerCommand('local-ai.codeGenetics', async () => {
        const genetics = new CodeGenetics(context);
        await genetics.showEvolutionUI();
      })
    );
  }

  // 🔗 GIT INTEGRATION: Analisar commit
  context.subscriptions.push(
    vscode.commands.registerCommand('local-ai.analyzeCommit', async () => {
      const analysis = await analyzeGitDiff();
      if (analysis) {
        await chatProvider.sendPrompt(
          `Análise de Commit Realizada:\n\n**Qualidade:** ${analysis.quality}/100\n\n**Issues:** ${analysis.issues.join(', ')}\n\n**Sugestões:** ${analysis.suggestions.join(', ')}`,
          'Análise de Commit'
        );
      }
    })
  );

  // 🔗 GIT INTEGRATION: Gerar mensagem de commit
  context.subscriptions.push(
    vscode.commands.registerCommand('local-ai.generateCommitMsg', async () => {
      const message = await generateCommitMessage();
      if (message) {
        vscode.window.showInformationMessage(`Local AI: ${message}`);
      }
    })
  );

  // 🔗 GIT INTEGRATION: Validar antes de push
  context.subscriptions.push(
    vscode.commands.registerCommand('local-ai.validateBeforePush', async () => {
      await validateBeforePush();
    })
  );

  // ⚙️ CONFIGURATION: Configurar provedor IA
  context.subscriptions.push(
    vscode.commands.registerCommand('local-ai.configureAI', async () => {
      await configureAIProvider(context.globalState, context.secrets);
    })
  );

  // ============================================================
  // 🚀 13 FEATURES FUTURAS
  // ============================================================

  // 1️⃣ ADVANCED CONTEXT MANAGER
  if (storage) {
    context.subscriptions.push(
      vscode.commands.registerCommand('local-ai.organizeContext', async () => {
        await showContextGroupsUI(storage);
      })
    );

    // Mostra exatamente o que é enviado ao modelo como contexto do projeto
    context.subscriptions.push(
      vscode.commands.registerCommand('local-ai.previewContext', async () => {
        const ctx = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'Montando contexto...' },
          () =>
            getProjectContext(
              getSelectedFilesConfig(storage),
              vscode.window.activeTextEditor?.document.uri.fsPath
            )
        );

        if (!ctx) {
          vscode.window.showWarningMessage(
            'Nenhum arquivo de código encontrado para o contexto. Abra uma pasta de projeto.'
          );
          return;
        }

        const doc = await vscode.workspace.openTextDocument({
          language: 'markdown',
          content:
            `<!-- ${ctx.includedFiles.length} arquivo(s), ${ctx.totalChars} caracteres.\n` +
            `     ${ctx.listedOnly} arquivo(s) entraram só como nome.\n` +
            `     Ajuste o tamanho em Settings > local-ai.numCtx -->\n\n${ctx.text}`,
        });
        await vscode.window.showTextDocument(doc, { preview: false });
      })
    );
  }

  // 2️⃣ SNIPPET MANAGER
  if (storage) {
    // globalStorage sobrevive a updates da extensão; extensionPath é sobrescrito
    const snippetManager = new SnippetManager(storage, context.globalStorageUri.fsPath);

    context.subscriptions.push(
      vscode.commands.registerCommand('local-ai.saveSnippet', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;
        const code = editor.document.getText(editor.selection);
        if (!code) return;

        const name = await vscode.window.showInputBox({ placeHolder: 'Snippet name' });
        if (name) {
          const tags = await vscode.window.showInputBox({ placeHolder: 'Tags (comma-separated)' });
          await snippetManager.createSnippet(
            name,
            code,
            editor.document.languageId,
            tags?.split(',').map((t) => t.trim()) || []
          );
          vscode.window.showInformationMessage(`✅ Snippet "${name}" salvo!`);
        }
      })
    );

    context.subscriptions.push(
      vscode.commands.registerCommand('local-ai.insertSnippet', async () => {
        await showSnippetsUI(snippetManager, 'insert');
      })
    );
  }
}
