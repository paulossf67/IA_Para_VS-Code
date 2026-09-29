import * as path from 'path';
import * as vscode from 'vscode';

const EXTENSIONS_BY_LANGUAGE: Record<string, string> = {
  csharp: '.cs',
  go: '.go',
  java: '.java',
  javascript: '.js',
  javascriptreact: '.jsx',
  markdown: '.md',
  python: '.py',
  typescript: '.ts',
  typescriptreact: '.tsx',
};

export class CodePreviewProvider implements vscode.TextDocumentContentProvider {
  static readonly scheme = 'local-ai-preview';
  private readonly contentByUri = new Map<string, string>();
  private nextPreviewId = 0;

  createPreview(content: string, fileName: string, side: 'original' | 'proposed', languageId: string): vscode.Uri {
    const originalExtension = path.extname(fileName);
    const extension = originalExtension || EXTENSIONS_BY_LANGUAGE[languageId] || '.txt';
    const baseName = path.basename(fileName, originalExtension) || 'code';
    const uri = vscode.Uri.from({
      scheme: CodePreviewProvider.scheme,
      path: `/preview-${this.nextPreviewId++}/${side}/${baseName}${extension}`,
    });
    this.contentByUri.set(uri.toString(), content);
    return uri;
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contentByUri.get(uri.toString()) ?? '';
  }

  release(uri: vscode.Uri): void {
    this.contentByUri.delete(uri.toString());
  }
}

export const codePreviewProvider = new CodePreviewProvider();