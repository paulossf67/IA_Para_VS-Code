import * as vscode from 'vscode';
import * as path from 'path';
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
import { getSelectedFilesConfig } from '../utils/contextStorage';
import { migrateFromContextSelector } from '../utils/advancedContextManager';
import { analyzeGitDiff, generateCommitMessage, validateBeforePush } from '../utils/gitIntegration';
import { configureAIProvider } from '../utils/multiAI';
import { AdvancedContextManager, showContextGroupsUI } from '../utils/advancedContextManager';
import { SnippetManager, showSnippetsUI } from '../utils/snippetManager';
import { SemanticSearcher } from '../utils/semanticSearch';
import { CodeGenetics } from '../utils/codeGenetics';
import { getValidationScripts, runNpmScript } from '../utils/projectValidation';
import { codePreviewProvider } from '../utils/codePreview';
import { GeneratedFile, parseGeneratedFiles } from '../utils/generatedFiles';

export function getSelectedCode(): { code: string; language: string } | null {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('Nenhum editor ativo.');
    return null;
  }

  const selection = editor.selection;
  const code = selection.isEmpty ? editor.document.getText() : editor.document.getText(selection);

  if (!code.trim()) {
    vscode.window.showWarningMessage('Não há código para analisar no editor atual.');
    return null;
  }

  return {
    code,
    language: editor.document.languageId,
  };
}

export function extractCodeBlock(response: string): string | null {
  const blocks = [...response.matchAll(/```[^\r\n]*\r?\n([\s\S]*?)```/g)];
  if (blocks.length !== 1) return null;

  const code = blocks[0][1].replace(/\r?\n$/, '');
  return code.trim() ? code : null;
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

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch (error) {
    if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') return false;
    throw error;
  }
}

async function runWorkspaceValidation(chatProvider: ChatViewProvider): Promise<void> {
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  const folder = (activeUri ? vscode.workspace.getWorkspaceFolder(activeUri) : undefined)
    ?? vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    void vscode.window.showWarningMessage('Local AI: abra uma pasta de projeto para executar validações.');
    return;
  }

  let scripts: string[];
  try {
    const packageUri = vscode.Uri.joinPath(folder.uri, 'package.json');
    const packageBytes = await vscode.workspace.fs.readFile(packageUri);
    scripts = getValidationScripts(Buffer.from(packageBytes).toString('utf8'));
  } catch {
    void vscode.window.showWarningMessage('Local AI: não encontrei um package.json legível nesta pasta.');
    return;
  }
  if (scripts.length === 0) {
    void vscode.window.showInformationMessage('Local AI: não encontrei scripts de teste, compilação ou lint conhecidos.');
    return;
  }

  const selected = await vscode.window.showQuickPick(
    scripts.map((script) => ({ label: `npm run ${script}`, script })),
    { placeHolder: 'Escolha uma validação definida em package.json' }
  );
  if (!selected) return;

  const confirmation = await vscode.window.showWarningMessage(
    `Executar "npm run ${selected.script}"? O script pode executar código definido pelo projeto.`,
    { modal: true },
    'Executar'
  );
  if (confirmation !== 'Executar') return;

  const result = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Local AI: executando npm run ${selected.script}`,
      cancellable: false,
    },
    () => runNpmScript(selected.script, folder.uri.fsPath)
  );

  if (result.exitCode === 0 && !result.timedOut) {
    void vscode.window.showInformationMessage(`Local AI: npm run ${selected.script} passou.`);
    return;
  }

  const reason = result.timedOut
    ? 'ultrapassou o limite de 2 minutos'
    : result.exitCode === null
      ? 'não pôde ser iniciado'
      : `falhou com código ${result.exitCode}`;
  const analyze = await vscode.window.showErrorMessage(
    `Local AI: npm run ${selected.script} ${reason}.`,
    'Analisar saída com IA'
  );
  if (analyze !== 'Analisar saída com IA') return;

  const consent = await vscode.window.showWarningMessage(
    'A saída da validação será enviada ao provedor de IA configurado. Deseja continuar?',
    { modal: true },
    'Enviar saída'
  );
  if (consent !== 'Enviar saída') return;

  await chatProvider.sendPromptAndWait(
    `O comando "npm run ${selected.script}" falhou após uma alteração de código. Analise a saída abaixo, explique as causas prováveis e sugira correções específicas. Não altere arquivos automaticamente.\n\n\`\`\`text\n${result.output || '(sem saída capturada)'}\n\`\`\``,
    'Analisar Falha de Validação'
  );
}

async function showCodeDiffPreview(
  original: string,
  proposed: string,
  fileName: string,
  languageId: string,
  applyLabel = 'Aplicar Código',
  discardLabel = 'Descartar'
): Promise<boolean> {
  const originalUri = codePreviewProvider.createPreview(original, fileName, 'original', languageId);
  const proposedUri = codePreviewProvider.createPreview(proposed, fileName, 'proposed', languageId);

  try {
    await vscode.commands.executeCommand(
      'vscode.diff',
      originalUri,
      proposedUri,
      `Local AI: Prévia de ${path.basename(fileName)}`
    );
    const decision = await vscode.window.showInformationMessage(
      'Confira a comparação aberta no editor antes de aplicar.',
      applyLabel,
      discardLabel
    );
    return decision === applyLabel;
  } catch (error) {
    codePreviewProvider.release(originalUri);
    codePreviewProvider.release(proposedUri);
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`Local AI: não foi possível abrir a prévia. ${message}`);
    return false;
  }
}

async function runCreateMultipleFilesCommand(
  chatProvider: ChatViewProvider,
  description: string,
  folder: vscode.Uri
): Promise<void> {
  const response = await chatProvider.sendPromptAndWait(
    `Implemente a solicitação abaixo criando os arquivos necessários no diretório selecionado.\n` +
    `Descrição: ${description}\n` +
    `Retorne apenas JSON válido neste formato: {"files":[{"path":"src/arquivo.ts","language":"typescript","content":"conteúdo completo"}]}.\n` +
    `Use caminhos relativos ao diretório selecionado, inclua testes quando apropriado e não use caminhos absolutos nem segmentos .. .\n` +
    `Limite a resposta a 8 arquivos e escape corretamente quebras de linha e aspas dentro de content.`,
    'Criar Vários Arquivos'
  );
  if (!response) return;

  let files: GeneratedFile[];
  try {
    files = parseGeneratedFiles(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showWarningMessage(`Local AI: não foi possível validar os arquivos gerados. ${message}`);
    return;
  }

  const entries = files.map((file) => ({
    ...file,
    uri: vscode.Uri.joinPath(folder, ...file.path.split('/')),
    content: file.content.endsWith('\n') ? file.content : `${file.content}\n`,
  }));

  try {
    for (const entry of entries) {
      if (await fileExists(entry.uri)) {
        void vscode.window.showWarningMessage(`Local AI: ${entry.path} já existe. Nenhum arquivo foi criado.`);
        return;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`Local AI: não foi possível verificar os destinos. ${message}`);
    return;
  }

  for (const entry of entries) {
    const approved = await showCodeDiffPreview(
      '',
      entry.content,
      entry.path,
      entry.language,
      'Incluir Arquivo',
      'Cancelar Lote'
    );
    if (!approved) return;
  }

  const confirmation = await vscode.window.showWarningMessage(
    `Criar ${entries.length} arquivos em ${folder.fsPath}? Nenhum arquivo existente será sobrescrito.`,
    { modal: true },
    'Criar Todos'
  );
  if (confirmation !== 'Criar Todos') return;

  try {
    for (const entry of entries) {
      if (await fileExists(entry.uri)) {
        void vscode.window.showWarningMessage(`Local AI: ${entry.path} foi criado durante a revisão. Nenhum arquivo foi criado.`);
        return;
      }
    }

    const directories = new Map<string, string[]>();
    for (const entry of entries) {
      const segments = entry.path.split('/');
      for (let depth = 1; depth < segments.length; depth++) {
        const directorySegments = segments.slice(0, depth);
        directories.set(directorySegments.join('/'), directorySegments);
      }
    }
    for (const directorySegments of [...directories.values()].sort((first, second) => first.length - second.length)) {
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(folder, ...directorySegments));
    }

    const edit = new vscode.WorkspaceEdit();
    for (const entry of entries) {
      edit.createFile(entry.uri, { overwrite: false, contents: new TextEncoder().encode(entry.content) });
    }
    if (!(await vscode.workspace.applyEdit(edit))) {
      void vscode.window.showErrorMessage('Local AI: não foi possível criar o conjunto de arquivos.');
      return;
    }

    const documents = await Promise.all(entries.map((entry) => vscode.workspace.openTextDocument(entry.uri)));
    await vscode.window.showTextDocument(documents[0]);
    for (const document of documents) {
      void vscode.commands.executeCommand('local-ai.reviewDocument', document);
    }
    const action = await vscode.window.showInformationMessage(
      `Local AI: ${entries.length} arquivos criados.`,
      'Executar Validação'
    );
    if (action === 'Executar Validação') await runWorkspaceValidation(chatProvider);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`Local AI: falha ao criar os arquivos. ${message}`);
  }
}

async function runCreateCodeCommand(chatProvider: ChatViewProvider): Promise<void> {
  const description = await vscode.window.showInputBox({
    prompt: 'Descreva a função ou o código que deseja criar',
    placeHolder: 'Ex.: função para validar e-mails com testes básicos',
  });
  if (!description?.trim()) return;

  const editor = vscode.window.activeTextEditor;
  const destinations = editor
    ? [
      { label: 'Inserir no cursor', value: 'editor' },
      { label: 'Criar um arquivo', value: 'file' },
      { label: 'Criar vários arquivos', value: 'files' },
    ]
    : [
      { label: 'Criar um arquivo', value: 'file' },
      { label: 'Criar vários arquivos', value: 'files' },
    ];
  const destination = await vscode.window.showQuickPick(destinations, {
    placeHolder: 'Onde deseja colocar o código gerado?',
  });
  if (!destination) return;

  if (destination.value === 'files') {
    const folders = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      openLabel: 'Selecionar Pasta',
      defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
    });
    if (!folders?.[0]) return;
    await runCreateMultipleFilesCommand(chatProvider, description.trim(), folders[0]);
    return;
  }

  let targetUri: vscode.Uri | undefined;
  if (destination.value === 'file') {
    targetUri = await vscode.window.showSaveDialog({
      title: 'Criar arquivo com Local AI',
      saveLabel: 'Criar Arquivo',
      defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
    });
    if (!targetUri) return;

    try {
      if (await fileExists(targetUri)) {
        void vscode.window.showWarningMessage('Local AI: o arquivo já existe. Escolha outro nome para evitar sobrescrever conteúdo.');
        return;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`Local AI: não foi possível verificar o destino. ${message}`);
      return;
    }
  }

  const documentVersion = editor?.document.version;
  const insertionRange = editor?.selection;
  const originalEditorText = editor?.document.getText() ?? '';
  const language = destination.value === 'editor' && editor
    ? editor.document.languageId
    : path.extname(targetUri?.fsPath ?? '').replace(/^\./, '') || 'inferida pelo nome do arquivo';
  const targetDescription = targetUri ? `arquivo ${path.basename(targetUri.fsPath)}` : 'editor atual';
  const prompt = `Crie o código solicitado para ${targetDescription}.
Descrição: ${description.trim()}
Linguagem ou extensão do arquivo: ${language}
Retorne exatamente um único bloco de código Markdown com todo o código a inserir, sem explicações antes ou depois.`;

  const response = await chatProvider.sendPromptAndWait(prompt, 'Criar Código');
  if (!response) return;

  const generatedCode = extractCodeBlock(response);
  if (!generatedCode) {
    void vscode.window.showWarningMessage('Local AI: não consegui identificar um único bloco de código; nada foi criado.');
    return;
  }

  if (!targetUri && (!editor || !insertionRange || editor.document.version !== documentVersion)) {
    void vscode.window.showWarningMessage('Local AI: o editor mudou durante a geração. O código não foi inserido.');
    return;
  }

  const lineEnding = editor?.document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
  const generatedContent = generatedCode.endsWith('\n')
    ? generatedCode
    : `${generatedCode}${targetUri ? '\n' : lineEnding}`;
  const targetFileName = targetUri?.fsPath ?? editor?.document.fileName ?? 'code.txt';
  let proposedEditorText = generatedContent;
  if (!targetUri && editor && insertionRange) {
    const startOffset = editor.document.offsetAt(insertionRange.start);
    const endOffset = editor.document.offsetAt(insertionRange.end);
    proposedEditorText = originalEditorText.slice(0, startOffset) + generatedContent + originalEditorText.slice(endOffset);
  }

  const approved = await showCodeDiffPreview(
    targetUri ? '' : originalEditorText,
    proposedEditorText,
    targetFileName,
    language
  );
  if (!approved) return;

  if (targetUri) {
    try {
      if (await fileExists(targetUri)) {
        void vscode.window.showWarningMessage('Local AI: o arquivo foi criado durante a geração. Nada foi sobrescrito.');
        return;
      }
      await vscode.workspace.fs.writeFile(targetUri, new TextEncoder().encode(generatedContent));
      const document = await vscode.workspace.openTextDocument(targetUri);
      await vscode.window.showTextDocument(document);
      void vscode.commands.executeCommand('local-ai.reviewDocument', document);
      const action = await vscode.window.showInformationMessage(
        `Local AI: arquivo ${path.basename(targetUri.fsPath)} criado.`,
        'Executar Validação'
      );
      if (action === 'Executar Validação') await runWorkspaceValidation(chatProvider);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`Local AI: não foi possível criar o arquivo. ${message}`);
    }
    return;
  }

  if (!editor || !insertionRange || editor.document.version !== documentVersion) {
    void vscode.window.showWarningMessage('Local AI: o editor mudou durante a geração. O código não foi inserido.');
    return;
  }

  const inserted = await editor.edit((edit) => edit.replace(insertionRange, generatedContent));
  if (inserted) {
    void vscode.commands.executeCommand('local-ai.reviewDocument', editor.document);
    const action = await vscode.window.showInformationMessage(
      'Local AI: código inserido no editor.',
      'Executar Validação'
    );
    if (action === 'Executar Validação') await runWorkspaceValidation(chatProvider);
  } else {
    void vscode.window.showErrorMessage('Local AI: não foi possível inserir o código no editor.');
  }
}

async function runFixCodeCommand(
  chatProvider: ChatViewProvider,
  review?: { issue: string; suggestion: string }
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  const selected = getSelectedCode();
  if (!editor || !selected) return;

  const document = editor.document;
  const originalVersion = document.version;
  const targetRange = editor.selection.isEmpty
    ? new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length))
    : editor.selection;
  const reviewContext = review
    ? `\n\nProblema identificado pela revisão: ${review.issue}\nSugestão da revisão: ${review.suggestion}`
    : '';
  const prompt = `Corrija o código abaixo, preservando seu comportamento e estilo sempre que possível.${reviewContext}
Retorne exatamente um bloco de código Markdown com o código completo corrigido, sem explicações antes ou depois.
Use a linguagem ${selected.language} na identificação do bloco.

 ${selected.code} `;

  const response = await chatProvider.sendPromptAndWait(prompt, 'Corrigir Código');
  if (!response) return;

  const correctedCode = extractCodeBlock(response);
  if (!correctedCode) {
    void vscode.window.showWarningMessage('Local AI: não consegui identificar um único bloco de código corrigido; o arquivo não foi alterado.');
    return;
  }
  if (correctedCode === selected.code) {
    void vscode.window.showInformationMessage('Local AI: nenhuma alteração necessária.');
    return;
  }
  if (document.version !== originalVersion) {
    void vscode.window.showWarningMessage('Local AI: o arquivo mudou durante a análise. Execute a correção novamente para evitar sobrescrever suas alterações.');
    return;
  }

  const confirmation = await vscode.window.showWarningMessage(
    'Aplicar a correção gerada ao código analisado?',
    { modal: true },
    'Aplicar Correção'
  );
  if (confirmation !== 'Aplicar Correção') return;
  if (document.version !== originalVersion) {
    void vscode.window.showWarningMessage('Local AI: o arquivo mudou antes da aplicação. Nenhuma alteração foi feita.');
    return;
  }

  const edit = new vscode.WorkspaceEdit();
  edit.replace(document.uri, targetRange, correctedCode);
  const applied = await vscode.workspace.applyEdit(edit);
  if (applied) {
    void vscode.window.showInformationMessage('Local AI: correção aplicada. Use Desfazer para reverter.');
  } else {
    void vscode.window.showErrorMessage('Local AI: não foi possível aplicar a correção ao arquivo.');
  }
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

  context.subscriptions.push(
    vscode.commands.registerCommand('local-ai.createCode', () => runCreateCodeCommand(chatProvider))
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('local-ai.validateWorkspace', () => runWorkspaceValidation(chatProvider))
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
      runFixCodeCommand(chatProvider)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'local-ai.fixDiagnostic',
      async (range: vscode.Range, issue: string, suggestion: string) => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showWarningMessage('Nenhum editor ativo.');
          return;
        }
        editor.selection = new vscode.Selection(range.start, range.end);
        await runFixCodeCommand(chatProvider, { issue, suggestion });
      }
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
      const config = await configureAIProvider(context.globalState, context.secrets);
      if (config) chatProvider.refreshModelLabel();
    })
  );

  // ============================================================
  // 🚀 ADVANCED CONTEXT MANAGER
  // ============================================================
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
