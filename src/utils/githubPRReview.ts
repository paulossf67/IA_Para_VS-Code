import * as vscode from 'vscode';
import * as cp from 'child_process';
import { chat } from './ollama';

export interface PRReviewComment {
  file: string;
  line: number;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  suggestion: string;
}

export interface PRReview {
  score: number; // 0-100
  comments: PRReviewComment[];
  summary: string;
}

export interface RepoInfo {
  owner: string;
  repo: string;
}

/** Token fica no SecretStorage; settings.json é texto plano e sincroniza. */
const TOKEN_SECRET = 'localAI_githubToken';
const API = 'https://api.github.com';
const MAX_DIFF_CHARS = 12000;

function git(args: string): Promise<string | null> {
  const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!cwd) return Promise.resolve(null);

  return new Promise((resolve) => {
    cp.exec(`git ${args}`, { cwd, maxBuffer: 10 * 1024 * 1024 }, (error, stdout) => {
      resolve(error ? null : stdout.trim());
    });
  });
}

/** Extrai owner/repo do remote, aceitando tanto HTTPS quanto SSH. */
export async function getRepoInfo(): Promise<RepoInfo | null> {
  const remote = await git('remote get-url origin');
  if (!remote) return null;

  const match = remote.match(/github\.com[:/]([^/]+)\/([^/.]+)(\.git)?$/i);
  if (!match) return null;

  return { owner: match[1], repo: match[2] };
}

export async function getCurrentBranch(): Promise<string | null> {
  return git('rev-parse --abbrev-ref HEAD');
}

async function api(
  token: string,
  path: string,
  init?: RequestInit & { raw?: boolean }
): Promise<any> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: init?.raw ? 'application/vnd.github.v3.diff' : 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    let detail = '';
    try {
      detail = ((await response.json()) as any)?.message ?? '';
    } catch {
      // resposta sem corpo JSON
    }

    const hint =
      response.status === 401
        ? ' Token inválido ou expirado.'
        : response.status === 403
          ? ' Token sem permissão. O PAT precisa do escopo "repo".'
          : response.status === 404
            ? ' Repositório ou PR não encontrado (repositório privado também dá 404 sem permissão).'
            : '';

    throw new Error(`GitHub respondeu ${response.status}. ${detail}${hint}`.trim());
  }

  return init?.raw ? response.text() : response.json();
}

/** Procura um PR aberto cujo branch de origem seja o informado. */
export async function findPullRequestForBranch(
  token: string,
  { owner, repo }: RepoInfo,
  branch: string
): Promise<number | null> {
  const prs = await api(token, `/repos/${owner}/${repo}/pulls?state=open&head=${owner}:${branch}`);
  return Array.isArray(prs) && prs.length > 0 ? prs[0].number : null;
}

export async function fetchPRDiff(
  token: string,
  { owner, repo }: RepoInfo,
  prNumber: number
): Promise<string> {
  return api(token, `/repos/${owner}/${repo}/pulls/${prNumber}`, { raw: true });
}

export async function reviewDiff(diff: string): Promise<PRReview> {
  const prompt = `Você é um revisor de código. Analise este diff e responda APENAS com JSON.

${diff.slice(0, MAX_DIFF_CHARS)}

Formato:
{
  "score": <0-100, qualidade geral>,
  "summary": "<2 a 3 frases sobre as mudanças>",
  "comments": [
    {"file": "caminho", "line": <numero>, "severity": "critical|warning|info",
     "message": "<o problema>", "suggestion": "<como corrigir>"}
  ]
}

Aponte no máximo 8 problemas, priorizando bugs e segurança sobre estilo.`;

  const response = await chat([{ role: 'user', content: prompt }], {
    maxTokens: 1200,
    temperature: 0.2,
  });

  try {
    const match = response.match(/\{[\s\S]*\}/);
    if (match) {
      const data = JSON.parse(match[0]);
      return {
        score: typeof data.score === 'number' ? data.score : 50,
        comments: Array.isArray(data.comments) ? data.comments : [],
        summary: data.summary ?? '',
      };
    }
  } catch {
    // modelo não devolveu JSON utilizável
  }

  return { score: 50, comments: [], summary: response.slice(0, 500) };
}

export function formatReviewAsMarkdown(review: PRReview): string {
  const icon = { critical: '🔴', warning: '⚠️', info: 'ℹ️' };

  let body = `## Revisão automática\n\n`;
  body += `**Qualidade estimada:** ${review.score}/100\n\n`;
  if (review.summary) body += `${review.summary}\n\n`;

  if (review.comments.length === 0) {
    body += `Nenhum problema encontrado.\n`;
  } else {
    body += `### Pontos de atenção (${review.comments.length})\n\n`;
    for (const c of review.comments) {
      body += `${icon[c.severity] ?? 'ℹ️'} **\`${c.file}\`** (linha ${c.line})\n`;
      body += `${c.message}\n`;
      if (c.suggestion) body += `> ${c.suggestion}\n`;
      body += `\n`;
    }
  }

  body += `\n---\n`;
  body += `<sub>Gerado localmente pela extensão Local AI Assistant. `;
  body += `Revisão automática erra — trate como sugestão, não como aprovação.</sub>\n`;

  return body;
}

export async function postComment(
  token: string,
  { owner, repo }: RepoInfo,
  prNumber: number,
  body: string
): Promise<string> {
  // PRs são issues para a API de comentários
  const created = await api(token, `/repos/${owner}/${repo}/issues/${prNumber}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
  return created.html_url;
}

/** Recupera o token, migrando o que estiver em settings.json (inseguro). */
export async function getToken(secrets: vscode.SecretStorage): Promise<string | undefined> {
  const stored = await secrets.get(TOKEN_SECRET);
  if (stored) return stored;

  const settings = vscode.workspace.getConfiguration('local-ai');
  const legacy = settings.get<string>('githubToken');
  if (legacy) {
    await secrets.store(TOKEN_SECRET, legacy);
    await settings.update('githubToken', undefined, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(
      'Local AI: token do GitHub movido das configurações para o armazenamento seguro.'
    );
    return legacy;
  }

  return undefined;
}

export async function promptForToken(secrets: vscode.SecretStorage): Promise<string | undefined> {
  const token = await vscode.window.showInputBox({
    prompt: 'Personal Access Token do GitHub (escopo "repo")',
    placeHolder: 'ghp_...',
    password: true,
    ignoreFocusOut: true,
  });

  if (token) {
    await secrets.store(TOKEN_SECRET, token.trim());
    return token.trim();
  }
  return undefined;
}

export async function clearToken(secrets: vscode.SecretStorage): Promise<void> {
  await secrets.delete(TOKEN_SECRET);
  vscode.window.showInformationMessage('Local AI: token do GitHub removido.');
}

export async function showGitHubPRReviewUI(secrets: vscode.SecretStorage): Promise<void> {
  const repo = await getRepoInfo();
  if (!repo) {
    vscode.window.showErrorMessage(
      'Local AI: não encontrei um remote do GitHub. Abra um repositório com "origin" apontando para o GitHub.'
    );
    return;
  }

  let token = await getToken(secrets);
  if (!token) {
    const action = await vscode.window.showWarningMessage(
      'Local AI: token do GitHub não configurado.',
      'Configurar agora'
    );
    if (action !== 'Configurar agora') return;
    token = await promptForToken(secrets);
    if (!token) return;
  }

  try {
    // Descobre o PR: o do branch atual, ou pergunta o número
    const branch = await getCurrentBranch();
    let prNumber = branch ? await findPullRequestForBranch(token, repo, branch) : null;

    if (!prNumber) {
      const typed = await vscode.window.showInputBox({
        prompt: `Nenhum PR aberto para "${branch ?? 'este branch'}". Informe o número do PR`,
        placeHolder: '123',
        validateInput: (v) => (/^\d+$/.test(v.trim()) ? undefined : 'Digite apenas números'),
      });
      if (!typed) return;
      prNumber = Number(typed.trim());
    }

    const review = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Analisando o PR...', cancellable: false },
      async (progress) => {
        progress.report({ message: 'buscando o diff...' });
        const diff = await fetchPRDiff(token!, repo, prNumber!);

        if (!diff.trim()) {
          throw new Error('O PR não tem mudanças para analisar.');
        }

        progress.report({ message: 'revisando com a IA...' });
        return reviewDiff(diff);
      }
    );

    const body = formatReviewAsMarkdown(review);

    // Postar cria um comentário público no PR: mostrar antes e confirmar
    const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: body });
    await vscode.window.showTextDocument(doc, { preview: true });

    const action = await vscode.window.showInformationMessage(
      `Publicar esta revisão como comentário no PR #${prNumber} de ${repo.owner}/${repo.repo}?`,
      { modal: true, detail: 'O comentário fica visível para todos que acessam o PR.' },
      'Publicar'
    );

    if (action !== 'Publicar') {
      vscode.window.showInformationMessage('Local AI: revisão não publicada. O texto continua aberto no editor.');
      return;
    }

    const url = await postComment(token, repo, prNumber, body);
    const open = await vscode.window.showInformationMessage(
      `Local AI: revisão publicada no PR #${prNumber}.`,
      'Abrir no GitHub'
    );
    if (open === 'Abrir no GitHub') {
      vscode.env.openExternal(vscode.Uri.parse(url));
    }
  } catch (error: any) {
    vscode.window.showErrorMessage(`Local AI: ${error.message}`);
  }
}
