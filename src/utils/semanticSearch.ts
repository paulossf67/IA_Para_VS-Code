import * as vscode from 'vscode';
import { chat, generateEmbedding, generateEmbeddingsBatch } from './ollama';
import { getProjectContext } from './projectContext';
import { getSelectedFilesConfig } from './contextSelector';

export interface SearchableItem {
  id: string;
  type: 'chat' | 'file';
  title: string;
  content: string;
  embedding?: number[];
  metadata?: {
    filePath?: string;
    lineStart?: number;
    lineEnd?: number;
    role?: 'user' | 'assistant';
    timestamp?: Date;
  };
}

export interface SearchResult {
  item: SearchableItem;
  score: number;
  highlights: string[];
}

const EMBEDDING_MODEL = 'nomic-embed-text';
const EMBEDDING_DIM = 768;
const SIMILARITY_THRESHOLD = 0.3;
const MAX_RESULTS = 10;
const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 50;

export class SemanticSearcher {
  private index: SearchableItem[] = [];
  private cache: Map<string, number[]> = new Map();
  private isIndexing = false;
  private abortController?: AbortController;

  constructor(private storage: vscode.Memento, private context: vscode.ExtensionContext) {}

  async initialize(): Promise<void> {
    const saved = this.storage.get<SearchableItem[]>('semanticIndex', []);
    // timestamp volta do storage como string JSON; reidrata para Date
    this.index = saved.map((item) => ({
      ...item,
      metadata: item.metadata
        ? {
            ...item.metadata,
            timestamp: item.metadata.timestamp ? new Date(item.metadata.timestamp) : undefined,
          }
        : undefined,
    }));
  }

  async persist(): Promise<void> {
    await this.storage.update('semanticIndex', this.index);
  }

  async indexChatHistory(messages: { role: 'user' | 'assistant'; content: string }[]): Promise<number> {
    const items: SearchableItem[] = messages
      .filter(m => m.content.trim().length > 20)
      .map((m, i) => ({
        id: `chat-${Date.now()}-${i}`,
        type: 'chat' as const,
        title: m.role === 'user' ? 'Você' : 'IA',
        content: m.content,
        metadata: { role: m.role, timestamp: new Date() },
      }));

    return this.indexItems(items);
  }

  async indexProjectFiles(
    storage: vscode.Memento,
    activeFile?: string
  ): Promise<number> {
    const ctx = await getProjectContext(getSelectedFilesConfig(storage), activeFile);
    if (!ctx) return 0;

    const items: SearchableItem[] = [];

    for (const filePath of ctx.includedFiles) {
      try {
        const uri = vscode.Uri.file(vscode.workspace.workspaceFolders![0].uri.fsPath + '/' + filePath);
        const bytes = await vscode.workspace.fs.readFile(uri);
        const content = Buffer.from(bytes).toString('utf-8');

        const chunks = this.chunkText(content, filePath);
        items.push(...chunks);
      } catch {
        // Ignore files that can't be read
      }
    }

    return this.indexItems(items);
  }

  private chunkText(content: string, filePath: string): SearchableItem[] {
    const lines = content.split('\n');
    const chunks: SearchableItem[] = [];

    for (let i = 0; i < lines.length; i += CHUNK_SIZE - CHUNK_OVERLAP) {
      const chunkLines = lines.slice(i, i + CHUNK_SIZE);
      if (chunkLines.length < 5) continue;

      const chunkContent = chunkLines.join('\n');
      if (chunkContent.trim().length < 50) continue;

      chunks.push({
        id: `file-${filePath}-${i}`,
        type: 'file',
        title: filePath,
        content: chunkContent,
        metadata: {
          filePath,
          lineStart: i + 1,
          lineEnd: Math.min(i + CHUNK_SIZE, lines.length),
        },
      });
    }

    return chunks;
  }

  private async indexItems(items: SearchableItem[]): Promise<number> {
    if (items.length === 0) return 0;

    this.isIndexing = true;
    this.abortController = new AbortController();

    try {
      const texts = items.map(item => item.content);
      const embeddings = await generateEmbeddingsBatch(texts, {
        model: EMBEDDING_MODEL,
        signal: this.abortController.signal,
      });

      let indexed = 0;
      for (let i = 0; i < items.length; i++) {
        if (this.abortController.signal.aborted) break;
        if (embeddings[i] && embeddings[i].length === EMBEDDING_DIM) {
          items[i].embedding = embeddings[i];
          this.index.push(items[i]);
          indexed++;
        }
      }

      await this.persist();
      return indexed;
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('[SemanticSearch] Indexing error:', err);
      }
      return 0;
    } finally {
      this.isIndexing = false;
    }
  }

  cancelIndexing(): void {
    this.abortController?.abort();
  }

  getIndexingStatus(): boolean {
    return this.isIndexing;
  }

  getIndexStats(): { total: number; chat: number; files: number } {
    return {
      total: this.index.length,
      chat: this.index.filter(i => i.type === 'chat').length,
      files: this.index.filter(i => i.type === 'file').length,
    };
  }

  async clearIndex(): Promise<void> {
    this.index = [];
    await this.persist();
  }

  async search(query: string, topK = MAX_RESULTS): Promise<SearchResult[]> {
    if (this.index.length === 0) return [];

    const queryEmbedding = await this.getEmbedding(query);
    if (!queryEmbedding.length) return [];

    const results: SearchResult[] = [];

    for (const item of this.index) {
      if (!item.embedding || item.embedding.length !== EMBEDDING_DIM) continue;

      const score = this.cosineSimilarity(queryEmbedding, item.embedding);
      if (score >= SIMILARITY_THRESHOLD) {
        const highlights = this.extractHighlights(item.content, query);
        results.push({ item, score, highlights });
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  private async getEmbedding(text: string): Promise<number[]> {
    const cached = this.cache.get(text);
    if (cached) return cached;

    try {
      const embedding = await generateEmbedding(text, { model: EMBEDDING_MODEL });
      this.cache.set(text, embedding);
      return embedding;
    } catch {
      return [];
    }
  }

  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }

    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom > 0 ? dot / denom : 0;
  }

  private extractHighlights(text: string, query: string): string[] {
    const words = query.toLowerCase().split(/\W+/).filter(w => w.length > 2);
    if (words.length === 0) return [];

    const regex = new RegExp(`\\b(${words.join('|')})\\b`, 'gi');
    const highlights: string[] = [];
    let match;

    while ((match = regex.exec(text)) !== null && highlights.length < 3) {
      const start = Math.max(0, match.index - 40);
      const end = Math.min(text.length, match.index + match[0].length + 40);
      highlights.push(`...${text.substring(start, end)}...`);
    }

    return highlights;
  }

  async showSearchUI(chatMessages?: { role: 'user' | 'assistant'; content: string }[]): Promise<void> {
    const query = await vscode.window.showInputBox({
      placeHolder: 'Busca semântica (ex: "Como validar formulário?", "padrão singleton")',
      prompt: 'Digite sua busca em linguagem natural',
    });

    if (!query) return;

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Buscando...' },
      async () => {
        const results = await this.search(query);

        if (results.length === 0) {
          vscode.window.showInformationMessage('Nenhum resultado encontrado. Tente indexar o projeto primeiro.');
          return;
        }

        const items = results.map(r => ({
          label: `${r.item.type === 'chat' ? '💬' : '📄'} ${r.item.title}`,
          description: `${(r.score * 100).toFixed(0)}% • ${r.highlights[0] || ''}`,
          detail: r.item.metadata?.filePath
            ? `Linha ${r.item.metadata.lineStart}-${r.item.metadata.lineEnd}`
            : `Chat ${r.item.metadata?.role}`,
          result: r,
        }));

        const selected = await vscode.window.showQuickPick(items, {
          matchOnDescription: true,
          matchOnDetail: true,
        });

        if (!selected) return;

        const { result } = selected;

        if (result.item.type === 'file' && result.item.metadata?.filePath) {
          const uri = vscode.Uri.file(
            vscode.workspace.workspaceFolders![0].uri.fsPath + '/' + result.item.metadata.filePath
          );
          const doc = await vscode.workspace.openTextDocument(uri);
          const editor = await vscode.window.showTextDocument(doc);
          editor.revealRange(
            new vscode.Range(
              result.item.metadata.lineStart! - 1, 0,
              result.item.metadata.lineEnd! - 1, 0
            )
          );
        } else if (result.item.type === 'chat') {
          await vscode.window.showInformationMessage(
            `${result.item.metadata?.role === 'user' ? 'Você' : 'IA'}:\n${result.item.content.slice(0, 500)}`
          );
        }
      }
    );
  }
}

export async function semanticSearchWithAI(query: string, history: SearchableItem[]): Promise<SearchableItem[]> {
  const context = history.map((e, i) => `[${i}] ${e.title}: ${e.content.slice(0, 200)}`).join('\n\n');

  const prompt = `Find entries related to: "${query}"

History:
${context}

Return indices (0-based) of relevant entries as JSON array: [1, 3, 5]`;

  try {
    const response = await chat([{ role: 'user', content: prompt }], { maxTokens: 100, temperature: 0 });

    const match = response.match(/\[\d+(?:,\s*\d+)*\]/);
    if (match) {
      const indices = JSON.parse(match[0]);
      return indices.map((i: number) => history[i]).filter(Boolean);
    }
  } catch {}

  return [];
}