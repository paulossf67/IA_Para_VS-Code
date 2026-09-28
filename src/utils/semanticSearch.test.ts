import { afterEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

const ollamaMocks = vi.hoisted(() => ({
  generateEmbedding: vi.fn(),
  generateEmbeddingsBatch: vi.fn(),
}));

vi.mock('./ollama', () => ({
  ...ollamaMocks,
  chat: vi.fn(),
}));

import { SearchableItem, SemanticSearcher } from './semanticSearch';

function createStorage(initial: SearchableItem[] = []) {
  let index = initial;
  const storage = {
    get: vi.fn((_key: string, defaultValue?: unknown) => index ?? defaultValue),
    update: vi.fn(async (_key: string, value: unknown) => {
      index = value as SearchableItem[];
    }),
  };

  return { storage: storage as unknown as vscode.Memento, read: () => index };
}

afterEach(() => {
  vi.clearAllMocks();
  vscode.__resetConfigOverrides();
});

describe('SemanticSearcher configuration', () => {
  it('uses the configured embedding model and accepts its vector dimensions', async () => {
    vscode.__configOverrides.embeddingModel = 'custom-embeddings';
    ollamaMocks.generateEmbeddingsBatch.mockResolvedValue([[1, 0]]);
    const { storage, read } = createStorage();
    const searcher = new SemanticSearcher(storage, {} as vscode.ExtensionContext);
    await searcher.initialize();

    const count = await searcher.indexChatHistory([
      { role: 'user', content: 'This is a sufficiently long message to index.' },
    ]);

    expect(count).toBe(1);
    expect(ollamaMocks.generateEmbeddingsBatch).toHaveBeenCalledWith(
      ['This is a sufficiently long message to index.'],
      expect.objectContaining({ model: 'custom-embeddings' })
    );
    expect(read()[0].embeddingModel).toBe('custom-embeddings');
  });

  it('applies the configured threshold and ignores vectors from another model', async () => {
    vscode.__configOverrides.embeddingModel = 'custom-embeddings';
    vscode.__configOverrides.similarityThreshold = 0.9;
    ollamaMocks.generateEmbedding.mockResolvedValue([0.8, 0.6]);
    const { storage } = createStorage([
      {
        id: 'current-model',
        type: 'chat',
        title: 'Current',
        content: 'current model result',
        embedding: [1, 0],
        embeddingModel: 'custom-embeddings',
      },
      {
        id: 'old-model',
        type: 'chat',
        title: 'Old',
        content: 'old model result',
        embedding: [1, 0],
      },
    ]);
    const searcher = new SemanticSearcher(storage, {} as vscode.ExtensionContext);
    await searcher.initialize();

    const results = await searcher.search('query');

    expect(ollamaMocks.generateEmbedding).toHaveBeenCalledWith('query', {
      model: 'custom-embeddings',
    });
    expect(results).toHaveLength(0);
  });
});