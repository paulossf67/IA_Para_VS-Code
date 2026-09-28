import * as vscode from 'vscode';

export type AIProvider = 'ollama' | 'claude' | 'gpt' | 'gemini';

export interface AIConfig {
  provider: AIProvider;
  model: string;
  baseUrl?: string;
  maxTokens: number;
}

const CONFIG_KEY = 'localAI_aiConfig';
const API_KEY_SECRET = 'localAI_apiKey';

export async function configureAIProvider(
  storage: vscode.Memento,
  secrets: vscode.SecretStorage
): Promise<AIConfig | null> {
  const providers = [
    { label: '🦙 Ollama (Local)', value: 'ollama', description: 'Roda localmente, sem dados na nuvem' },
    { label: '🧠 Claude (API)', value: 'claude', description: 'Melhor qualidade, mas pago' },
    { label: '⚡ ChatGPT', value: 'gpt', description: 'Rápido e confiável' },
    { label: '✨ Gemini', value: 'gemini', description: 'Grátis com conta Google' },
  ];

  const picked = await vscode.window.showQuickPick(providers, {
    placeHolder: 'Escolha provedor de IA',
  });

  if (!picked) return null;

  let config: AIConfig = {
    provider: picked.value as AIProvider,
    model: '',
    maxTokens: 1024,
  };

  if (picked.value !== 'ollama') {
    const apiKey = await vscode.window.showInputBox({
      prompt: `Cole sua chave API ${picked.label}`,
      password: true,
    });

    if (!apiKey) return null;

    await secrets.store(API_KEY_SECRET, apiKey);

    const models = await listModelsForProvider(picked.value as AIProvider, apiKey);
    const selectedModel = await vscode.window.showQuickPick(models, {
      placeHolder: 'Escolha modelo',
    });

    if (!selectedModel) return null;
    config.model = selectedModel;
  } else {
    config.model = 'qwen2.5-coder:7b';
    await secrets.delete(API_KEY_SECRET);
  }

  await storage.update(CONFIG_KEY, config);
  vscode.window.showInformationMessage(`✅ Provedor IA: ${picked.label}`);

  return config;
}

async function listModelsForProvider(provider: AIProvider, _apiKey: string): Promise<string[]> {
  switch (provider) {
    case 'claude':
      return ['claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku'];
    case 'gpt':
      return ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo'];
    case 'gemini':
      return ['gemini-pro', 'gemini-pro-vision'];
    default:
      return [];
  }
}

export async function chatWithAI(
  storage: vscode.Memento,
  secrets: vscode.SecretStorage,
  messages: { role: string; content: string }[],
  options?: { maxTokens?: number; temperature?: number }
): Promise<string> {
  const config = getAIConfig(storage);
  if (!config) {
    throw new Error('Nenhum provedor de IA configurado. Rode "Local AI: Configurar Provedor IA"');
  }

  const apiKey = config.provider !== 'ollama' ? await secrets.get(API_KEY_SECRET) : undefined;
  if (config.provider !== 'ollama' && !apiKey) {
    throw new Error('API key não encontrada. Reconfigure o provedor.');
  }

  switch (config.provider) {
    case 'ollama':
      return chatOllama(messages, options);
    case 'claude':
      return chatClaude(apiKey!, config.model, messages, options);
    case 'gpt':
      return chatGPT(apiKey!, config.model, messages, options);
    case 'gemini':
      return chatGemini(apiKey!, config.model, messages, options);
    default:
      throw new Error(`Provedor não suportado: ${config.provider}`);
  }
}

async function chatOllama(
  messages: { role: string; content: string }[],
  options?: { maxTokens?: number; temperature?: number }
): Promise<string> {
  const { chatStream } = await import('./ollama');
  let response = '';
  await chatStream(messages as any, (chunk) => (response += chunk));
  return response;
}

/**
 * Mesma interface de `chatStream`, mas respeitando o provedor configurado.
 * Ollama transmite token a token; os provedores de nuvem respondem de uma vez
 * e o texto é entregue ao callback em um único bloco.
 */
export async function chatStreamWithAI(
  storage: vscode.Memento,
  secrets: vscode.SecretStorage,
  messages: { role: string; content: string }[],
  onChunk: (text: string) => void,
  signal?: AbortSignal,
  options?: { maxTokens?: number; temperature?: number }
): Promise<string> {
  const config = getAIConfig(storage);

  // Sem configuração explícita, o padrão continua sendo o Ollama local
  if (!config || config.provider === 'ollama') {
    const { chatStream } = await import('./ollama');
    return chatStream(messages as any, onChunk, signal);
  }

  const apiKey = await secrets.get(API_KEY_SECRET);
  if (!apiKey) {
    throw new Error(
      `Chave de API do provedor "${config.provider}" não encontrada. ` +
        'Rode "Local AI: Configurar Provedor IA" novamente.'
    );
  }

  const text = await chatWithAI(storage, secrets, messages, options);
  if (signal?.aborted) return '';

  onChunk(text);
  return text;
}

/** Transforma erro HTTP em mensagem que diz o que fazer. */
async function ensureOk(response: Response, provider: string): Promise<void> {
  if (response.ok) return;

  let detail = '';
  try {
    const body = (await response.json()) as any;
    detail = body?.error?.message || body?.error?.type || '';
  } catch {
    // corpo não-JSON: a mensagem de status já basta
  }

  const hint =
    response.status === 401 || response.status === 403
      ? ' Verifique a chave de API em "Local AI: Configurar Provedor IA".'
      : response.status === 429
        ? ' Limite de requisições atingido — aguarde e tente de novo.'
        : '';

  throw new Error(`${provider} respondeu ${response.status}. ${detail}${hint}`.trim());
}

async function chatClaude(
  apiKey: string,
  model: string,
  messages: { role: string; content: string }[],
  options?: { maxTokens?: number; temperature?: number }
): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: options?.maxTokens || 1024,
      messages: messages.filter((m) => m.role !== 'system'),
      system: messages.find((m) => m.role === 'system')?.content,
    }),
  });

  await ensureOk(response, 'Claude');
  const data = (await response.json()) as any;
  return data.content?.[0]?.text ?? '';
}

async function chatGPT(
  apiKey: string,
  model: string,
  messages: { role: string; content: string }[],
  options?: { maxTokens?: number; temperature?: number }
): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      max_tokens: options?.maxTokens || 1024,
      temperature: options?.temperature || 0.2,
    }),
  });

  await ensureOk(response, 'ChatGPT');
  const data = (await response.json()) as any;
  return data.choices?.[0]?.message?.content ?? '';
}

async function chatGemini(
  apiKey: string,
  model: string,
  messages: { role: string; content: string }[],
  options?: { maxTokens?: number; temperature?: number }
): Promise<string> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: messages.map((m) => ({
          role: m.role === 'user' ? 'user' : 'model',
          parts: [{ text: m.content }],
        })),
        generationConfig: {
          maxOutputTokens: options?.maxTokens || 1024,
          temperature: options?.temperature || 0.2,
        },
      }),
    }
  );

  await ensureOk(response, 'Gemini');
  const data = (await response.json()) as any;
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

export function getAIConfig(storage: vscode.Memento): AIConfig | null {
  return storage.get<AIConfig>(CONFIG_KEY) ?? null;
}

export function requiresOllama(storage: vscode.Memento): boolean {
  const config = getAIConfig(storage);
  return !config || config.provider === 'ollama';
}

export async function resetAIConfig(storage: vscode.Memento, secrets: vscode.SecretStorage): Promise<void> {
  await storage.update(CONFIG_KEY, null);
  await secrets.delete(API_KEY_SECRET);
  vscode.window.showInformationMessage('Configuração de IA resetada');
}