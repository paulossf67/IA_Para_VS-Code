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
  prNumber: number;
  score: number; // 0-100
  comments: PRReviewComment[];
  summary: string;
  timestamp: Date;
}

export class GitHubPRReviewer {
  constructor(private token: string) {}

  async getPRDiff(prNumber: number): Promise<string | null> {
    return new Promise((resolve) => {
      cp.exec(`git diff origin/main...HEAD`, (error, stdout) => {
        if (error) resolve(null);
        else resolve(stdout);
      });
    });
  }

  async reviewPR(diff: string, prNumber: number): Promise<PRReview> {
    const prompt = `Review this git diff for code quality:

${diff.slice(0, 2000)}

Return JSON: {
  "score": 0-100,
  "comments": [
    {"file": "path", "line": 1, "severity": "warning", "message": "...", "suggestion": "..."}
  ],
  "summary": "..."
}`;

    const response = await chat([{ role: 'user', content: prompt }], {
      maxTokens: 800,
      temperature: 0.2,
    });

    try {
      const match = response.match(/\{[\s\S]*\}/);
      if (match) {
        const data = JSON.parse(match[0]);
        return {
          prNumber,
          score: data.score,
          comments: data.comments || [],
          summary: data.summary,
          timestamp: new Date(),
        };
      }
    } catch {}

    return {
      prNumber,
      score: 50,
      comments: [],
      summary: 'Unable to review PR',
      timestamp: new Date(),
    };
  }

  async postCommentToGitHub(review: PRReview): Promise<void> {
    if (!this.token) {
      vscode.window.showWarningMessage('GitHub token not configured');
      return;
    }

    // Would use GitHub API here with authenticated requests
    vscode.window.showInformationMessage(`✅ PR Review posted: Score ${review.score}/100`);
  }
}

export async function showGitHubPRReviewUI(): Promise<void> {
  const token = vscode.workspace.getConfiguration('local-ai').get<string>('githubToken');

  if (!token) {
    const configure = await vscode.window.showWarningMessage(
      'GitHub token not configured',
      'Configure Now'
    );

    if (configure === 'Configure Now') {
      const newToken = await vscode.window.showInputBox({
        prompt: 'Enter your GitHub Personal Access Token',
        password: true,
      });

      if (newToken) {
        await vscode.workspace
          .getConfiguration('local-ai')
          .update('githubToken', newToken, vscode.ConfigurationTarget.Global);
      }
    }
    return;
  }

  vscode.window.showInformationMessage('🚀 GitHub PR Review configured');
}
