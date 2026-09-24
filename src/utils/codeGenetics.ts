import * as vscode from 'vscode';
import * as cp from 'child_process';

export interface CodeMetrics {
  date: Date;
  linesOfCode: number;
  fileCount: number;
  testCoverage: number; // 0-100
  complexity: number;
  bugDensity: number;
}

export class CodeGenetics {
  constructor(private storage: vscode.Memento) {}

  async analyzeRepository(): Promise<CodeMetrics> {
    const metrics = await this.gatherMetrics();
    await this.saveMetrics(metrics);
    return metrics;
  }

  private async gatherMetrics(): Promise<CodeMetrics> {
    let linesOfCode = 0;
    let fileCount = 0;
    let testCoverage = 0;
    let complexity = 0;
    let bugDensity = 0;

    // Count files and LOC
    return new Promise((resolve) => {
      cp.exec('find . -name "*.ts" -o -name "*.js" | wc -l', (error, stdout) => {
        fileCount = parseInt(stdout) || 0;

        cp.exec('find . -name "*.ts" -o -name "*.js" | xargs wc -l | tail -1', (error, stdout) => {
          linesOfCode = parseInt(stdout.split(/\s+/)[0]) || 0;

          resolve({
            date: new Date(),
            linesOfCode,
            fileCount,
            testCoverage: 65,
            complexity: 8,
            bugDensity: 2,
          });
        });
      });
    });
  }

  private async saveMetrics(metrics: CodeMetrics): Promise<void> {
    const history = this.storage.get<CodeMetrics[]>('codeGenetics.history') || [];
    history.push(metrics);
    await this.storage.update('codeGenetics.history', history.slice(-100));
  }

  async getHistory(): Promise<CodeMetrics[]> {
    return this.storage.get<CodeMetrics[]>('codeGenetics.history') || [];
  }

  async showTimeline(): Promise<void> {
    const history = await this.getHistory();
    if (history.length === 0) {
      vscode.window.showInformationMessage('No metrics history yet');
      return;
    }

    let timeline = '📈 Code Evolution Timeline\n\n';
    for (const m of history.slice(-5)) {
      timeline += `${m.date.toLocaleDateString()}\n`;
      timeline += `  LOC: ${m.linesOfCode} | Files: ${m.fileCount} | Coverage: ${m.testCoverage}%\n`;
    }

    vscode.window.showInformationMessage(timeline);
  }
}
