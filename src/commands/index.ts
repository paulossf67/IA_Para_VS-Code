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
import { selectFilesForContext, clearSelectedFiles } from '../utils/contextSelector';
import { analyzeGitDiff, generateCommitMessage, validateBeforePush } from '../utils/gitIntegration';
import { AdvancedContextManager, showContextGroupsUI } from '../utils/advancedContextManager';
import { SnippetManager, showSnippetsUI } from '../utils/snippetManager';
import { QualityScoreTracker } from '../utils/qualityScore';
import { BugDetective, showBugDetectiveUI } from '../utils/bugDetective';
import { SemanticSearcher } from '../utils/semanticSearch';
import { showVoiceUI } from '../utils/voiceCommands';
import { showDocGeneratorUI } from '../utils/docGenerator';
import { showPerformanceProfilerUI } from '../utils/performanceProfiler';
import { showGitHubPRReviewUI } from '../utils/githubPRReview';
import { showLearningPathUI, LearningPathTracker } from '../utils/learningPaths';
import { CodeGenetics } from '../utils/codeGenetics';
import { showTeamCollaborationUI } from '../utils/teamCollaboration';
import { showMarketplaceUI } from '../utils/localMarketplace';

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

  // Selecionar arquivos para context
  if (storage) {
    context.subscriptions.push(
      vscode.commands.registerCommand('local-ai.selectContextFiles', async () => {
        await selectFilesForContext(storage);
      })
    );

    // Limpar seleção de arquivos
    context.subscriptions.push(
      vscode.commands.registerCommand('local-ai.clearContextFiles', async () => {
        await clearSelectedFiles(storage);
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
      const providers = ['ollama', 'claude', 'gpt', 'gemini'];
      const picked = await vscode.window.showQuickPick(providers, {
        placeHolder: 'Escolha o provedor de IA'
      });

      if (picked) {
        await vscode.workspace
          .getConfiguration('local-ai')
          .update('aiProvider', picked, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(`Local AI: provedor alterado para ${picked}`);
      }
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
  }

  // 2️⃣ SNIPPET MANAGER
  if (storage) {
    const snippetManager = new SnippetManager(storage, context.extensionPath);

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

  // 3️⃣ QUALITY SCORE
  if (storage) {
    const qualityTracker = new QualityScoreTracker(storage);

    context.subscriptions.push(
      vscode.commands.registerCommand('local-ai.showQualityDashboard', async () => {
        await qualityTracker.showDashboard();
      })
    );
  }

  // 4️⃣ BUG DETECTIVE
  context.subscriptions.push(
    vscode.commands.registerCommand('local-ai.detectBugs', async () => {
      const detective = new BugDetective();
      await showBugDetectiveUI(detective);
    })
  );

  // 5️⃣ SEMANTIC SEARCH
  context.subscriptions.push(
    vscode.commands.registerCommand('local-ai.semanticSearch', async () => {
      vscode.window.showInformationMessage('🔍 Semantic search coming soon');
    })
  );

  // 6️⃣ VOICE COMMANDS
  context.subscriptions.push(
    vscode.commands.registerCommand('local-ai.voiceCommand', async () => {
      await showVoiceUI();
    })
  );

  // 7️⃣ DOC GENERATOR
  context.subscriptions.push(
    vscode.commands.registerCommand('local-ai.generateDocs', async () => {
      await showDocGeneratorUI();
    })
  );

  // 8️⃣ PERFORMANCE PROFILER
  context.subscriptions.push(
    vscode.commands.registerCommand('local-ai.profilePerformance', async () => {
      await showPerformanceProfilerUI();
    })
  );

  // 9️⃣ GITHUB PR REVIEW
  context.subscriptions.push(
    vscode.commands.registerCommand('local-ai.reviewPR', async () => {
      await showGitHubPRReviewUI();
    })
  );

  // 🔟 LEARNING PATHS
  if (storage) {
    const learningTracker = new LearningPathTracker(storage);

    context.subscriptions.push(
      vscode.commands.registerCommand('local-ai.showLearningPaths', async () => {
        await showLearningPathUI(learningTracker);
      })
    );
  }

  // 1️⃣1️⃣ CODE GENETICS
  if (storage) {
    const genetics = new CodeGenetics(storage);

    context.subscriptions.push(
      vscode.commands.registerCommand('local-ai.showCodeGenetics', async () => {
        await genetics.showTimeline();
      })
    );
  }

  // 1️⃣2️⃣ TEAM COLLABORATION
  context.subscriptions.push(
    vscode.commands.registerCommand('local-ai.teamCollaboration', async () => {
      await showTeamCollaborationUI();
    })
  );

  // 1️⃣3️⃣ LOCAL MARKETPLACE
  context.subscriptions.push(
    vscode.commands.registerCommand('local-ai.marketplace', async () => {
      await showMarketplaceUI();
    })
  );
}
