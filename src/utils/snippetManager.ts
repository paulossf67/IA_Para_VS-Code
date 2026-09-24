import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface AISnippet {
  id: string;
  name: string;
  code: string;
  language: string;
  description: string;
  tags: string[];
  rating: number; // 0-5 stars
  usedCount: number;
  createdAt: Date;
  updatedAt: Date;
  context?: string; // When to use this snippet
}

const STORAGE_KEY = 'local-ai.snippets';
const MAX_SNIPPETS = 500;

export class SnippetManager {
  private snippetsDir: string;

  constructor(
    private storage: vscode.Memento,
    extensionPath: string
  ) {
    this.snippetsDir = path.join(extensionPath, 'snippets');
    if (!fs.existsSync(this.snippetsDir)) {
      fs.mkdirSync(this.snippetsDir, { recursive: true });
    }
  }

  async loadSnippets(): Promise<AISnippet[]> {
    const stored = this.storage.get<string[]>(STORAGE_KEY) || [];
    const snippets: AISnippet[] = [];

    for (const id of stored.slice(0, MAX_SNIPPETS)) {
      const snippet = await this.loadSnippet(id);
      if (snippet) snippets.push(snippet);
    }

    return snippets;
  }

  async loadSnippet(id: string): Promise<AISnippet | null> {
    try {
      const filePath = path.join(this.snippetsDir, `${id}.json`);
      if (fs.existsSync(filePath)) {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        return data as AISnippet;
      }
    } catch {}
    return null;
  }

  async saveSnippet(snippet: AISnippet): Promise<void> {
    const filePath = path.join(this.snippetsDir, `${snippet.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(snippet, null, 2));

    const ids = this.storage.get<string[]>(STORAGE_KEY) || [];
    if (!ids.includes(snippet.id)) {
      ids.push(snippet.id);
      await this.storage.update(STORAGE_KEY, ids.slice(-MAX_SNIPPETS));
    }
  }

  async createSnippet(
    name: string,
    code: string,
    language: string,
    tags: string[] = []
  ): Promise<AISnippet> {
    const snippet: AISnippet = {
      id: `snippet-${Date.now()}`,
      name,
      code,
      language,
      description: '',
      tags,
      rating: 0,
      usedCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await this.saveSnippet(snippet);
    return snippet;
  }

  async deleteSnippet(id: string): Promise<void> {
    const filePath = path.join(this.snippetsDir, `${id}.json`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    const ids = this.storage.get<string[]>(STORAGE_KEY) || [];
    await this.storage.update(
      STORAGE_KEY,
      ids.filter((i) => i !== id)
    );
  }

  async rateSnippet(id: string, rating: number): Promise<void> {
    const snippet = await this.loadSnippet(id);
    if (snippet) {
      snippet.rating = Math.min(5, Math.max(0, rating));
      snippet.updatedAt = new Date();
      await this.saveSnippet(snippet);
    }
  }

  async incrementUsedCount(id: string): Promise<void> {
    const snippet = await this.loadSnippet(id);
    if (snippet) {
      snippet.usedCount++;
      snippet.updatedAt = new Date();
      await this.saveSnippet(snippet);
    }
  }

  async searchSnippets(query: string): Promise<AISnippet[]> {
    const snippets = await this.loadSnippets();
    const lowerQuery = query.toLowerCase();

    return snippets.filter(
      (s) =>
        s.name.toLowerCase().includes(lowerQuery) ||
        s.tags.some((t) => t.toLowerCase().includes(lowerQuery)) ||
        s.language.toLowerCase().includes(lowerQuery)
    );
  }

  async exportSnippets(): Promise<string> {
    const snippets = await this.loadSnippets();
    return JSON.stringify(snippets, null, 2);
  }

  async importSnippets(jsonData: string): Promise<number> {
    try {
      const snippets: AISnippet[] = JSON.parse(jsonData);
      let imported = 0;

      for (const snippet of snippets) {
        if (snippet.code && snippet.language) {
          snippet.id = `snippet-${Date.now()}-${Math.random()}`;
          await this.saveSnippet(snippet);
          imported++;
        }
      }

      return imported;
    } catch {
      return 0;
    }
  }

  async getTopRated(limit: number = 10): Promise<AISnippet[]> {
    const snippets = await this.loadSnippets();
    return snippets.sort((a, b) => b.rating - a.rating).slice(0, limit);
  }

  async getMostUsed(limit: number = 10): Promise<AISnippet[]> {
    const snippets = await this.loadSnippets();
    return snippets.sort((a, b) => b.usedCount - a.usedCount).slice(0, limit);
  }
}

export async function showSnippetsUI(
  manager: SnippetManager,
  action: 'view' | 'insert' | 'rate' = 'view'
): Promise<AISnippet | null> {
  const snippets = await manager.loadSnippets();
  if (snippets.length === 0) {
    vscode.window.showInformationMessage('Nenhum snippet salvo ainda');
    return null;
  }

  const items = snippets.map((s) => ({
    label: `${s.name} (${s.language})`,
    description: `⭐ ${s.rating.toFixed(1)} | Used ${s.usedCount}x | Tags: ${s.tags.join(', ')}`,
    snippet: s,
  }));

  const selected = await vscode.window.showQuickPick(items, {
    placeHolder: `${action === 'view' ? 'View' : 'Insert'} snippet`,
  });

  if (selected) {
    if (action === 'view') {
      vscode.window.showInformationMessage(
        `📌 ${selected.snippet.name}\n${selected.snippet.description || 'No description'}`
      );
    } else if (action === 'insert') {
      const editor = vscode.window.activeTextEditor;
      if (editor) {
        const position = editor.selection.active;
        await editor.edit((builder) => {
          builder.insert(position, selected.snippet.code);
        });
        await manager.incrementUsedCount(selected.snippet.id);
        vscode.window.showInformationMessage('✅ Snippet inserido');
      }
    }
    return selected.snippet;
  }

  return null;
}
