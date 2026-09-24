import * as vscode from 'vscode';
import { chat } from './ollama';

export interface HistoryEntry {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  embedding?: number[]; // Simple vector representation
}

export interface SearchResult {
  entry: HistoryEntry;
  relevance: number; // 0-1
  highlights: string[];
}

export class SemanticSearcher {
  private cache: Map<string, number[]> = new Map();

  async getEmbedding(text: string): Promise<number[]> {
    // Check cache first
    if (this.cache.has(text)) {
      return this.cache.get(text)!;
    }

    // Simple embedding: TF-IDF-like approach
    const embedding = this.simpleEmbedding(text);
    this.cache.set(text, embedding);
    return embedding;
  }

  private simpleEmbedding(text: string): number[] {
    const words = text.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
    const vector: number[] = [];

    // Create a 100-dimensional vector based on word frequencies
    for (let i = 0; i < 100; i++) {
      let value = 0;
      for (const word of words) {
        const charCode = word.charCodeAt(i % word.length) || 0;
        value += charCode / 256;
      }
      vector.push(value / Math.max(1, words.length));
    }

    return vector;
  }

  cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let magnitudeA = 0;
    let magnitudeB = 0;

    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      dotProduct += a[i] * b[i];
      magnitudeA += a[i] * a[i];
      magnitudeB += b[i] * b[i];
    }

    const denominator = Math.sqrt(magnitudeA) * Math.sqrt(magnitudeB);
    return denominator > 0 ? dotProduct / denominator : 0;
  }

  async search(query: string, history: HistoryEntry[], topK: number = 5): Promise<SearchResult[]> {
    const queryEmbedding = await this.getEmbedding(query);

    const results: SearchResult[] = [];

    for (const entry of history) {
      const entryEmbedding = entry.embedding || (await this.getEmbedding(entry.content));
      const relevance = this.cosineSimilarity(queryEmbedding, entryEmbedding);

      if (relevance > 0.1) {
        // Include if similarity is above threshold
        const highlights = this.extractHighlights(entry.content, query);
        results.push({
          entry,
          relevance,
          highlights,
        });
      }
    }

    // Sort by relevance and return top K
    return results.sort((a, b) => b.relevance - a.relevance).slice(0, topK);
  }

  private extractHighlights(text: string, query: string): string[] {
    const words = query.toLowerCase().split(/\W+/);
    const highlights: string[] = [];
    const regex = new RegExp(`\\b(${words.join('|')})\\b`, 'gi');
    let match;

    while ((match = regex.exec(text)) !== null && highlights.length < 3) {
      const start = Math.max(0, match.index - 20);
      const end = Math.min(text.length, match.index + match[0].length + 20);
      highlights.push(`...${text.substring(start, end)}...`);
    }

    return highlights;
  }

  async showSearchUI(history: HistoryEntry[]): Promise<void> {
    const query = await vscode.window.showInputBox({
      placeHolder: 'Search history semantically (e.g., "Como fazer validação?")',
    });

    if (!query) return;

    const results = await this.search(query, history);

    if (results.length === 0) {
      vscode.window.showInformationMessage('No results found');
      return;
    }

    const items = results.map((r) => ({
      label: `${r.entry.role === 'user' ? 'You' : 'AI'}: ${r.entry.content.slice(0, 50)}...`,
      description: `Relevance: ${(r.relevance * 100).toFixed(0)}%`,
      result: r,
    }));

    const selected = await vscode.window.showQuickPick(items);
    if (selected) {
      vscode.window.showInformationMessage(
        `${selected.result.entry.role === 'user' ? 'You' : 'AI'}:\n${selected.result.entry.content}`
      );
    }
  }
}

// Alternative: Use AI to understand semantic meaning
export async function semanticSearchWithAI(query: string, history: HistoryEntry[]): Promise<string[]> {
  const context = history.map((e) => `[${e.role.toUpperCase()}] ${e.content}`).join('\n\n');

  const prompt = `Find entries related to: "${query}"

History:
${context}

Return line numbers (0-indexed) of relevant entries, as JSON: [1, 3, 5]`;

  try {
    const response = await chat([{ role: 'user', content: prompt }], { maxTokens: 100, temperature: 0 });

    const match = response.match(/\[\d+(?:,\s*\d+)*\]/);
    if (match) {
      const indices = JSON.parse(match[0]);
      return indices.map((i: number) => history[i]?.content).filter(Boolean);
    }
  } catch {}

  return [];
}
