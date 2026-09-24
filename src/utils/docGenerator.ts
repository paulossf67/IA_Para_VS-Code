import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { chat } from './ollama';

export interface GeneratedDocs {
  readme: string;
  contributing: string;
  architecture: string;
  api: string;
}

export class DocumentationGenerator {
  async generateReadme(projectName: string, description: string, files: string[]): Promise<string> {
    const prompt = `Generate a professional README.md for "${projectName}".
    Description: ${description}
    Files: ${files.join(', ').slice(0, 500)}

    Include: Overview, Features, Installation, Usage, API, Contributing, License`;

    const readme = await chat([{ role: 'user', content: prompt }], {
      maxTokens: 1024,
      temperature: 0.3,
    });

    return readme;
  }

  async generateAll(workspaceDir: string): Promise<GeneratedDocs> {
    const packagePath = path.join(workspaceDir, 'package.json');
    let projectName = 'My Project';
    let description = 'A great project';

    if (fs.existsSync(packagePath)) {
      const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf-8'));
      projectName = pkg.name || projectName;
      description = pkg.description || description;
    }

    const files = fs.readdirSync(path.join(workspaceDir, 'src')).slice(0, 10);

    const [readme, contributing, architecture, api] = await Promise.all([
      this.generateReadme(projectName, description, files),
      this.generateContributing(),
      this.generateArchitecture(files),
      this.generateAPI(),
    ]);

    return { readme, contributing, architecture, api };
  }

  private async generateContributing(): Promise<string> {
    const prompt =
      'Generate a CONTRIBUTING.md file with guidelines for contributing to a project. Include: setup, development, testing, pull request process.';

    return chat([{ role: 'user', content: prompt }], { maxTokens: 512, temperature: 0.3 });
  }

  private async generateArchitecture(files: string[]): Promise<string> {
    const prompt = `Generate an ARCHITECTURE.md explaining the project structure.
    Files: ${files.join(', ')}`;

    return chat([{ role: 'user', content: prompt }], { maxTokens: 512, temperature: 0.3 });
  }

  private async generateAPI(): Promise<string> {
    const prompt = 'Generate an API.md file documenting common API patterns and endpoints.';

    return chat([{ role: 'user', content: prompt }], { maxTokens: 512, temperature: 0.3 });
  }

  async saveDocuments(docs: GeneratedDocs, outputDir: string): Promise<void> {
    fs.writeFileSync(path.join(outputDir, 'README.md'), docs.readme);
    fs.writeFileSync(path.join(outputDir, 'CONTRIBUTING.md'), docs.contributing);
    fs.writeFileSync(path.join(outputDir, 'ARCHITECTURE.md'), docs.architecture);
    fs.writeFileSync(path.join(outputDir, 'API.md'), docs.api);
  }
}

export async function showDocGeneratorUI(): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('No workspace folder open');
    return;
  }

  const generator = new DocumentationGenerator();

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: '📚 Generating documentation...',
    },
    async () => {
      const docs = await generator.generateAll(workspaceFolder.uri.fsPath);
      await generator.saveDocuments(docs, workspaceFolder.uri.fsPath);
    }
  );

  vscode.window.showInformationMessage('✅ Documentation generated!');
}
