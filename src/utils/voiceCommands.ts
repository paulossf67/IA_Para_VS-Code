import * as vscode from 'vscode';
import { chat } from './ollama';

export class VoiceCommandHandler {
  async startRecording(): Promise<string | null> {
    const message = 'Voice recording requires web audio API. Use chat input for now.';
    vscode.window.showInformationMessage(message);
    return null;
  }

  async transcribeAudio(audioData: Buffer): Promise<string> {
    // Placeholder: In production, use Whisper or similar
    // For now, fallback to user typing
    const text = await vscode.window.showInputBox({
      placeHolder: 'Microphone input not available. Type your command:',
    });
    return text || '';
  }

  async speakText(text: string): Promise<void> {
    // Placeholder: Use system text-to-speech
    vscode.window.showInformationMessage(`[AUDIO] ${text.slice(0, 100)}`);
  }

  async handleVoiceCommand(input: string): Promise<string> {
    // Route to appropriate command based on voice input
    if (input.includes('explain') || input.includes('what is')) {
      return 'Explicar Código';
    } else if (input.includes('test')) {
      return 'Gerar Testes';
    } else if (input.includes('refactor') || input.includes('improve')) {
      return 'Refatorar Código';
    } else if (input.includes('fix') || input.includes('bug')) {
      return 'Corrigir Código';
    } else if (input.includes('document') || input.includes('doc')) {
      return 'Gerar Documentação';
    }
    return 'Abrir Chat';
  }
}

export async function showVoiceUI(): Promise<void> {
  const handler = new VoiceCommandHandler();

  const options = ['🎤 Record Voice', '⌨️  Type Instead'];
  const choice = await vscode.window.showQuickPick(options);

  if (choice === '🎤 Record Voice') {
    vscode.window.showInformationMessage(
      '🎙️  Voice input requires special configuration. Please use the chat instead.'
    );
  } else if (choice === '⌨️  Type Instead') {
    const input = await vscode.window.showInputBox({
      placeHolder: 'Speak your command (e.g., "Explain this code")',
    });

    if (input) {
      const command = await handler.handleVoiceCommand(input);
      await vscode.commands.executeCommand(`local-ai.${command}`);
    }
  }
}
