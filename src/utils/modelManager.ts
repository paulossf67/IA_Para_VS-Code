import * as vscode from 'vscode';
import { getConfig } from './ollama';

export interface ModelConfig {
  name: string;
  size: 'small' | 'medium' | 'large';
  useCase: 'autocomplete' | 'analysis' | 'generation';
  maxTokens: number;
  temperature: number;
}

const DEFAULT_MODELS: { [key: string]: ModelConfig } = {
  small: {
    name: 'phi:2.7b',
    size: 'small',
    useCase: 'autocomplete',
    maxTokens: 128,
    temperature: 0.1,
  },
  medium: {
    name: 'qwen2.5-coder:7b',
    size: 'medium',
    useCase: 'analysis',
    maxTokens: 1024,
    temperature: 0.2,
  },
  large: {
    name: 'deepseek-coder-v2:16b',
    size: 'large',
    useCase: 'generation',
    maxTokens: 2048,
    temperature: 0.3,
  },
};

const STORAGE_KEY = 'localAI_modelConfig';

export async function selectModel(storage: vscode.Memento, useCase: 'autocomplete' | 'analysis' | 'generation'): Promise<ModelConfig | null> {
  const modelSizes = ['small', 'medium', 'large'];

  const picked = await vscode.window.showQuickPick(
    modelSizes.map((size) => ({
      label: `${size.charAt(0).toUpperCase() + size.slice(1)} - ${DEFAULT_MODELS[size].name}`,
      description: `Para ${DEFAULT_MODELS[size].useCase}`,
      value: size,
    })),
    { placeHolder: `Escolha modelo para ${useCase}` }
  );

  if (!picked) return null;

  const config = DEFAULT_MODELS[picked.value];
  const saved = (await storage.get<{ [key: string]: ModelConfig }>(STORAGE_KEY, {})) || {};
  saved[useCase] = config;

  await storage.update(STORAGE_KEY, saved);
  vscode.window.showInformationMessage(`Modelo para ${useCase}: ${config.name}`);

  return config;
}

export function getModelForUseCase(storage: vscode.Memento, useCase: 'autocomplete' | 'analysis' | 'generation'): ModelConfig {
  const saved = storage.get<{ [key: string]: ModelConfig }>(STORAGE_KEY, {}) || {};

  if (saved[useCase]) {
    return saved[useCase];
  }

  // Padrão por tipo
  const defaults: { [key: string]: string } = {
    autocomplete: 'small',
    analysis: 'medium',
    generation: 'large',
  };

  return DEFAULT_MODELS[defaults[useCase]];
}

export function getAllModels(): ModelConfig[] {
  return Object.values(DEFAULT_MODELS);
}

export async function resetModelConfig(storage: vscode.Memento): Promise<void> {
  await storage.update(STORAGE_KEY, {});
  vscode.window.showInformationMessage('Configuração de modelos resetada');
}
