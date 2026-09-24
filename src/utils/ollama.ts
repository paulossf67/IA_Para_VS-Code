import * as vscode from 'vscode';

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OllamaChatResponse {
  message?: {
    role: string;
    content: string;
  };
  done: boolean;
  error?: string;
}

interface OllamaGenerateResponse {
  response?: string;
  done: boolean;
  error?: string;
}

export interface LocalAIConfig {
  url: string;
  model: string;
  maxTokens: number;
  temperature: number;
  numCtx: number;
  maxHistoryMessages: number;
}

/**
 * Lê as configurações. Usa `??` (e não `||`) para que valores como 0 sejam respeitados.
 */
export function getConfig(): LocalAIConfig {
  const config = vscode.workspace.getConfiguration('local-ai');
  const url = (config.get<string>('ollamaUrl') ?? '').trim() || 'http://localhost:11434';
  return {
    url: url.replace(/\/+$/, ''),
    model: (config.get<string>('model') ?? '').trim() || 'qwen2.5-coder:7b',
    maxTokens: config.get<number>('maxTokens') ?? 1024,
    temperature: config.get<number>('temperature') ?? 0.2,
    numCtx: config.get<number>('numCtx') ?? 8192,
    maxHistoryMessages: config.get<number>('maxHistoryMessages') ?? 20,
  };
}

/**
 * Verifica se o Ollama está rodando
 */
export async function checkOllamaAvailable(): Promise<boolean> {
  const { url } = getConfig();
  try {
    const response = await fetch(`${url}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Lista modelos disponíveis no Ollama
 */
export async function listModels(): Promise<string[]> {
  const { url } = getConfig();
  try {
    const response = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return [];
    const data = (await response.json()) as { models?: { name: string }[] };
    return data.models?.map((m) => m.name) || [];
  } catch {
    return [];
  }
}

/**
 * Verifica se um modelo está instalado. "qwen2.5-coder" casa com "qwen2.5-coder:latest".
 */
export function isModelInstalled(model: string, installed: string[]): boolean {
  const wanted = model.includes(':') ? model : `${model}:latest`;
  return installed.some((m) => m === model || m === wanted);
}

/**
 * Mantém o prompt de sistema + as últimas N mensagens, para não estourar o contexto do modelo.
 */
export function trimHistory(messages: OllamaMessage[], maxMessages: number): OllamaMessage[] {
  const system = messages.filter((m) => m.role === 'system');
  const rest = messages.filter((m) => m.role !== 'system');
  if (maxMessages <= 0 || rest.length <= maxMessages) return messages;
  let trimmed = rest.slice(rest.length - maxMessages);
  // Não começar a conversa com uma resposta do assistente solta
  while (trimmed.length > 0 && trimmed[0].role === 'assistant') {
    trimmed = trimmed.slice(1);
  }
  return [...system, ...trimmed];
}

async function throwHttpError(response: Response): Promise<never> {
  const text = await response.text().catch(() => '');
  let detail = text;
  try {
    const parsed = JSON.parse(text) as { error?: string };
    if (parsed.error) detail = parsed.error;
  } catch {
    // mantém o texto cru
  }
  if (response.status === 404 && /model/i.test(detail)) {
    const { model } = getConfig();
    throw new Error(`Modelo "${model}" não encontrado no Ollama. Rode: ollama pull ${model}`);
  }
  throw new Error(`Ollama error ${response.status}: ${detail}`);
}

/**
 * Lê uma resposta NDJSON (uma linha JSON por evento) de forma segura:
 * linhas que chegam divididas entre dois pedaços são juntadas antes do parse.
 */
export async function readNdjson<T>(
  body: ReadableStream<Uint8Array>,
  onObject: (obj: T) => void
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const handleLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed: T;
    try {
      parsed = JSON.parse(trimmed) as T;
    } catch {
      return; // linha realmente inválida
    }
    onObject(parsed);
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
      handleLine(buffer.slice(0, newlineIndex));
      buffer = buffer.slice(newlineIndex + 1);
    }
  }
  buffer += decoder.decode();
  handleLine(buffer);
}

/**
 * Chat completion (não streaming)
 */
export async function chat(
  messages: OllamaMessage[],
  options?: { temperature?: number; maxTokens?: number; signal?: AbortSignal }
): Promise<string> {
  const config = getConfig();

  const body = {
    model: config.model,
    messages,
    stream: false,
    options: {
      temperature: options?.temperature ?? config.temperature,
      num_predict: options?.maxTokens ?? config.maxTokens,
      num_ctx: config.numCtx,
    },
  };

  const response = await fetch(`${config.url}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: options?.signal,
  });

  if (!response.ok) {
    await throwHttpError(response);
  }

  const data = (await response.json()) as OllamaChatResponse;
  if (data.error) throw new Error(data.error);
  return data.message?.content || '';
}

/**
 * Chat com streaming (para o painel de chat)
 */
export async function chatStream(
  messages: OllamaMessage[],
  onChunk: (text: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const config = getConfig();

  const body = {
    model: config.model,
    messages,
    stream: true,
    options: {
      temperature: config.temperature,
      num_predict: config.maxTokens,
      num_ctx: config.numCtx,
    },
  };

  const response = await fetch(`${config.url}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    await throwHttpError(response);
  }

  if (!response.body) {
    throw new Error('Resposta sem body');
  }

  let fullContent = '';
  let streamError: string | undefined;

  await readNdjson<OllamaChatResponse>(response.body, (parsed) => {
    if (parsed.error) {
      streamError = parsed.error;
      return;
    }
    if (parsed.message?.content) {
      fullContent += parsed.message.content;
      onChunk(parsed.message.content);
    }
  });

  if (streamError) throw new Error(streamError);
  return fullContent;
}

/**
 * Fill-in-the-middle (FIM): o modelo recebe o código antes e depois do cursor
 * e gera só o trecho do meio. Modelos como qwen2.5-coder, deepseek-coder e
 * codellama foram treinados para isso.
 * Lança FimNotSupportedError se o modelo não suportar `suffix`.
 */
export class FimNotSupportedError extends Error {}

export async function generateFim(
  prefix: string,
  suffix: string,
  options?: { temperature?: number; maxTokens?: number; signal?: AbortSignal }
): Promise<string> {
  const config = getConfig();

  const body = {
    model: config.model,
    prompt: prefix,
    suffix,
    stream: false,
    options: {
      temperature: options?.temperature ?? 0.1,
      num_predict: options?.maxTokens ?? 128,
      num_ctx: config.numCtx,
      stop: ['\n\n\n'],
    },
  };

  const response = await fetch(`${config.url}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: options?.signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    if (/does not support insert|suffix/i.test(text)) {
      throw new FimNotSupportedError(text);
    }
    throw new Error(`Ollama error ${response.status}: ${text}`);
  }

  const data = (await response.json()) as OllamaGenerateResponse;
  if (data.error) {
    if (/does not support insert|suffix/i.test(data.error)) {
      throw new FimNotSupportedError(data.error);
    }
    throw new Error(data.error);
  }
  return data.response || '';
}

/**
 * Remove cercas de markdown (```lang ... ```) que o modelo às vezes coloca,
 * sem mexer na indentação do código.
 */
export function stripCodeFences(text: string): string {
  let result = text.replace(/^\s*```[\w+#.-]*[ \t]*\r?\n?/, '');
  result = result.replace(/\r?\n?```\s*$/, '');
  return result;
}

/**
 * Prompt de sistema padrão para código
 */
export const SYSTEM_PROMPT = `Você é um assistente de programação especialista.
Responda de forma clara, objetiva e em português brasileiro.
Quando mostrar código, use blocos markdown com a linguagem correta.
Foque em qualidade, legibilidade e boas práticas.`;
