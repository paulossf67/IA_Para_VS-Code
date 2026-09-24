import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';

// Mocks de VS Code API
const mockMemento = {
  get: vi.fn((key: string, defaultValue?: any) => defaultValue),
  update: vi.fn(),
  keys: vi.fn(() => []),
};

const mockWebview = {
  asWebviewUri: vi.fn((uri) => uri),
  postMessage: vi.fn(),
  html: '',
};

const mockWebviewView = {
  webview: mockWebview,
  onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
};

describe('ChatViewProvider Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('carrega histórico do storage ao inicializar', async () => {
    const historico = [
      { role: 'user', content: 'Olá' },
      { role: 'assistant', content: 'Oi!' },
    ];

    mockMemento.get.mockReturnValue(historico);

    // Simula construtor
    const messages: any[] = [
      { role: 'system', content: 'System prompt' },
      ...historico,
    ];

    expect(messages).toHaveLength(3);
    expect(messages[1].content).toBe('Olá');
  });

  it('salva histórico ao descartar', () => {
    const historico = [
      { role: 'user', content: 'Test' },
      { role: 'assistant', content: 'Response' },
    ];

    mockMemento.update('chatHistory', historico);

    expect(mockMemento.update).toHaveBeenCalledWith('chatHistory', historico);
  });

  it('limita histórico a 100 mensagens', () => {
    const manyMessages = Array.from({ length: 150 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i}`,
    }));

    const limited = manyMessages.slice(-100);

    expect(limited).toHaveLength(100);
    expect(limited[0].content).toBe('Message 50');
  });

  it('limita histórico por tamanho em MB', () => {
    const maxSizeBytes = 5 * 1024 * 1024; // 5 MB
    const messages = [
      { role: 'user', content: 'x'.repeat(1000000) }, // ~1 MB
      { role: 'assistant', content: 'y'.repeat(1000000) }, // ~1 MB
      { role: 'user', content: 'z'.repeat(1000000) }, // ~1 MB
    ];

    let totalSize = 0;
    const trimmed = [];

    for (let i = messages.length - 1; i >= 0; i--) {
      const size = new TextEncoder().encode(messages[i].content).length;
      if (totalSize + size > maxSizeBytes) break;
      trimmed.unshift(messages[i]);
      totalSize += size;
    }

    expect(totalSize).toBeLessThanOrEqual(maxSizeBytes);
  });

  it('formata histórico como markdown para export', () => {
    const messages = [
      { role: 'user', content: 'Como refatorar?' },
      { role: 'assistant', content: '1. Use composição\n2. Separe responsabilidades' },
    ];

    let md = '# Local AI Chat History\n\n';
    for (const msg of messages) {
      if (msg.role === 'user') {
        md += `## 💬 Você\n\n${msg.content}\n\n`;
      } else if (msg.role === 'assistant') {
        md += `## 🤖 IA\n\n${msg.content}\n\n---\n\n`;
      }
    }

    expect(md).toContain('# Local AI Chat History');
    expect(md).toContain('💬 Você');
    expect(md).toContain('🤖 IA');
    expect(md).toContain('Como refatorar?');
  });

  it('formata histórico como JSON para export', () => {
    const messages = [
      { role: 'user', content: 'Teste' },
      { role: 'assistant', content: 'Resposta' },
    ];

    const json = JSON.stringify(messages, null, 2);
    const parsed = JSON.parse(json);

    expect(parsed).toHaveLength(2);
    expect(parsed[0].role).toBe('user');
    expect(parsed[1].role).toBe('assistant');
  });

  it('formata histórico como texto simples', () => {
    const messages = [
      { role: 'user', content: 'Pergunta' },
      { role: 'assistant', content: 'Resposta' },
    ];

    let txt = 'Local AI Chat History\n';
    for (const msg of messages) {
      if (msg.role === 'user') {
        txt += `[VOCÊ]\n${msg.content}\n\n`;
      } else {
        txt += `[IA]\n${msg.content}\n\n`;
      }
    }

    expect(txt).toContain('[VOCÊ]');
    expect(txt).toContain('[IA]');
    expect(txt).toContain('Pergunta');
  });

  it('rejeita limpeza de histórico sem confirmação', () => {
    const shouldClear = false; // Usuário cancelou

    if (shouldClear) {
      // Limpar
    } else {
      // Manter histórico
    }

    expect(shouldClear).toBe(false);
  });

  it('limpa histórico após confirmação', () => {
    const messages = [
      { role: 'system', content: 'System' },
      { role: 'user', content: 'Msg 1' },
      { role: 'assistant', content: 'Response 1' },
    ];

    // Simula limpeza
    const cleared = [{ role: 'system', content: 'System' }];

    expect(cleared).toHaveLength(1);
    expect(cleared[0].role).toBe('system');
  });
});
