import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { requiresOllama } from './multiAI';

describe('requiresOllama', () => {
  it('defaults to Ollama when no provider has been configured', () => {
    const storage = { get: (_key: string, defaultValue?: unknown) => defaultValue } as vscode.Memento;
    expect(requiresOllama(storage)).toBe(true);
  });

  it('requires Ollama only when the configured provider is local', () => {
    const cloudStorage = {
      get: () => ({ provider: 'gpt', model: 'gpt-4', maxTokens: 1024 }),
    } as unknown as vscode.Memento;
    const ollamaStorage = {
      get: () => ({ provider: 'ollama', model: 'qwen2.5-coder:7b', maxTokens: 1024 }),
    } as unknown as vscode.Memento;

    expect(requiresOllama(cloudStorage)).toBe(false);
    expect(requiresOllama(ollamaStorage)).toBe(true);
  });
});