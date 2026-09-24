import { describe, it, expect, vi, beforeEach } from 'vitest';
import { trimHistory, stripCodeFences, isModelInstalled } from './ollama';
import type { OllamaMessage } from './ollama';

describe('Ollama Utils', () => {
  describe('trimHistory', () => {
    it('mantém prompt de sistema + últimas N mensagens', () => {
      const messages: OllamaMessage[] = [
        { role: 'system', content: 'system' },
        { role: 'user', content: 'user1' },
        { role: 'assistant', content: 'assist1' },
        { role: 'user', content: 'user2' },
        { role: 'assistant', content: 'assist2' },
      ];

      const trimmed = trimHistory(messages, 2);

      expect(trimmed).toHaveLength(3);
      expect(trimmed[0].role).toBe('system');
      expect(trimmed[1].content).toBe('user2');
      expect(trimmed[2].content).toBe('assist2');
    });

    it('não começa com resposta do assistente', () => {
      const messages: OllamaMessage[] = [
        { role: 'system', content: 'system' },
        { role: 'assistant', content: 'lonely assistant' },
        { role: 'user', content: 'user' },
        { role: 'assistant', content: 'response' },
      ];

      const trimmed = trimHistory(messages, 2);

      expect(trimmed[1].role).toBe('user');
    });
  });

  describe('stripCodeFences', () => {
    it('remove cerca markdown simples', () => {
      const text = '```typescript\nconst x = 1;\n```';
      const result = stripCodeFences(text);

      expect(result).toBe('const x = 1;');
    });

    it('remove cerca com quebras de linha extras', () => {
      const text = '```\n\ncode here\n\n```';
      const result = stripCodeFences(text);

      expect(result).toBe('\ncode here\n');
    });

    it('retorna texto intacto sem cercas', () => {
      const text = 'plain text';
      const result = stripCodeFences(text);

      expect(result).toBe('plain text');
    });
  });

  describe('isModelInstalled', () => {
    it('encontra modelo com mesma tag', () => {
      const installed = ['qwen2.5-coder:7b', 'deepseek-coder:16b'];

      expect(isModelInstalled('qwen2.5-coder:7b', installed)).toBe(true);
    });

    it('encontra modelo com tag :latest implícita', () => {
      const installed = ['qwen2.5-coder:latest', 'deepseek-coder:16b'];

      expect(isModelInstalled('qwen2.5-coder', installed)).toBe(true);
    });

    it('não encontra modelo não instalado', () => {
      const installed = ['qwen2.5-coder:7b'];

      expect(isModelInstalled('nonexistent:latest', installed)).toBe(false);
    });
  });
});
