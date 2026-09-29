import * as vscode from 'vscode';
import * as path from 'path';
import { chat } from './ollama';

export interface CommitAnalysis {
  quality: number;
  issues: string[];
  suggestions: string[];
  message: string;
}

interface GitAPI {
  repositories: Repository[];
}

interface Repository {
  rootUri: vscode.Uri;
  diffIndexWithHEAD(options?: { cached?: boolean }): Promise<string>;
  getDiff(uncommitted?: boolean): Promise<string>;
}

let gitAPI: GitAPI | null = null;

async function getGitAPI(forceRefresh = false): Promise<GitAPI | null> {
  if (gitAPI && !forceRefresh) return gitAPI;

  if (forceRefresh) {
    gitAPI = null;
  }

  const gitExt = vscode.extensions.getExtension('vscode.git');
  if (!gitExt) {
    vscode.window.showWarningMessage('Local AI: Extensão Git do VS Code não encontrada');
    return null;
  }

  if (!gitExt.isActive) {
    await gitExt.activate();
  }

  const api = gitExt.exports.getAPI(1);
  if (!api || !api.repositories?.length) {
    vscode.window.showWarningMessage('Local AI: Nenhum repositório Git aberto');
    return null;
  }

  gitAPI = api;
  return api;
}

async function getRepository(): Promise<Repository | null> {
  const api = await getGitAPI();
  if (!api || !api.repositories.length) return null;
  return api.repositories[0];
}

async function getGitDiff(cached = true): Promise<string | null> {
  try {
    const repo = await getRepository();
    if (!repo) return null;

    if (typeof repo.diffIndexWithHEAD === 'function') {
      return await repo.diffIndexWithHEAD({ cached });
    }

    return await repo.getDiff(!cached);
  } catch {
    return null;
  }
}

export async function getWorkspaceGitDiff(activeUri?: vscode.Uri): Promise<string | null> {
  try {
    const api = await getGitAPI(true);
    if (!api?.repositories.length) return null;

    const activePath = activeUri?.fsPath;
    const repository = activePath
      ? api.repositories
        .filter((candidate) => {
          const relative = path.relative(candidate.rootUri.fsPath, activePath);
          return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
        })
        .sort((first, second) => second.rootUri.fsPath.length - first.rootUri.fsPath.length)[0]
      : undefined;
    const selectedRepository = repository ?? api.repositories[0];

    let staged = '';
    let unstaged = '';
    if (typeof selectedRepository.diffIndexWithHEAD === 'function') {
      [staged, unstaged] = await Promise.all([
        selectedRepository.diffIndexWithHEAD({ cached: true }),
        selectedRepository.diffIndexWithHEAD({ cached: false }),
      ]);
    } else {
      unstaged = await selectedRepository.getDiff(true);
    }

    const sections = [
      staged.trim() ? `Alterações staged:\n${staged.trim()}` : '',
      unstaged.trim() ? `Alterações unstaged:\n${unstaged.trim()}` : '',
    ].filter(Boolean);
    if (sections.length === 0) return null;

    const diff = sections.join('\n\n');
    const maxChars = 6000;
    return `### Diff Git do repositório ativo\n\n\`\`\`diff\n${diff.slice(0, maxChars)}${diff.length > maxChars ? '\n… (diff truncado)' : ''}\n\`\`\``;
  } catch {
    return null;
  }
}

export async function analyzeGitDiff(): Promise<CommitAnalysis | null> {
  try {
    const diff = await getGitDiff(true);
    if (!diff) {
      vscode.window.showWarningMessage('Local AI: Nenhuma mudança staged para analisar');
      return null;
    }

    const analysis = await analyzeChanges(diff);
    showAnalysisResult(analysis);

    return analysis;
  } catch (error: any) {
    vscode.window.showErrorMessage(`Local AI: Erro ao analisar git: ${error.message}`);
    return null;
  }
}

async function analyzeChanges(diff: string): Promise<CommitAnalysis> {
  const prompt = `Analise este git diff brevemente:

${diff.slice(0, 3000)}

Retorne JSON: {"quality": 1-100, "issues": [...], "suggestions": [...], "message": "..."}`;

  const response = await chat(
    [
      { role: 'system', content: 'Retorne JSON puro' },
      { role: 'user', content: prompt },
    ],
    { maxTokens: 512, temperature: 0.2 }
  );

  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch {}

  return {
    quality: 50,
    issues: ['Não foi possível analisar'],
    suggestions: [],
    message: response,
  };
}

function showAnalysisResult(analysis: CommitAnalysis): void {
  const qualityBar = '█'.repeat(Math.floor(analysis.quality / 10)) + '░'.repeat(10 - Math.floor(analysis.quality / 10));

  const message = `
Local AI - Análise de Commit

Qualidade: ${qualityBar} ${analysis.quality}%

Issues (${analysis.issues.length}):
${analysis.issues.map((i) => `  • ${i}`).join('\n')}

Sugestões (${analysis.suggestions.length}):
${analysis.suggestions.map((s) => `  • ${s}`).join('\n')}

${analysis.message}
`;

  vscode.window.showInformationMessage(message, { modal: false });
}

export async function validateBeforePush(): Promise<boolean> {
  const analysis = await analyzeGitDiff();
  if (!analysis) return true;

  if (analysis.quality < 50) {
    const action = await vscode.window.showWarningMessage(
      `Qualidade baixa (${analysis.quality}%). Continuar push?`,
      'Sim',
      'Não'
    );
    return action === 'Sim';
  }

  return true;
}

export async function generateCommitMessage(): Promise<string | null> {
  const diff = await getGitDiff(true);
  if (!diff) {
    vscode.window.showWarningMessage('Nenhuma mudança staged para gerar mensagem');
    return null;
  }

  const prompt = `Gere uma mensagem de commit clara e concisa (max 100 chars) baseado neste diff:
${diff.slice(0, 2000)}

Retorne APENAS a mensagem, sem explicações.`;

  const message = await chat(
    [{ role: 'user', content: prompt }],
    { maxTokens: 100, temperature: 0.1 }
  );

  return message.trim();
}