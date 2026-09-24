import * as vscode from 'vscode';

export interface LearningPath {
  topic: string;
  level: 'beginner' | 'intermediate' | 'advanced';
  progress: number; // 0-100
  resources: string[];
  nextSteps: string[];
  estimatedTime: string;
}

export class LearningPathTracker {
  constructor(private storage: vscode.Memento) {}

  private paths: Map<string, LearningPath> = new Map([
    [
      'async-await',
      {
        topic: 'Async/Await',
        level: 'beginner',
        progress: 0,
        resources: ['MDN Web Docs', 'JavaScript.info', 'Egghead.io'],
        nextSteps: ['Learn Promise basics', 'Understand async/await syntax', 'Error handling with try/catch'],
        estimatedTime: '2-3 hours',
      },
    ],
    [
      'react-hooks',
      {
        topic: 'React Hooks',
        level: 'intermediate',
        progress: 0,
        resources: ['React Documentation', 'React Conf Talks', 'Ultimate React Course'],
        nextSteps: ['useState', 'useEffect', 'Custom Hooks'],
        estimatedTime: '4-5 hours',
      },
    ],
    [
      'typescript-generics',
      {
        topic: 'TypeScript Generics',
        level: 'advanced',
        progress: 0,
        resources: ['TypeScript Handbook', 'Advanced TypeScript Course'],
        nextSteps: ['Generic Functions', 'Generic Interfaces', 'Conditional Types'],
        estimatedTime: '3-4 hours',
      },
    ],
  ]);

  detectTopic(code: string): string | null {
    if (code.includes('async') || code.includes('await')) return 'async-await';
    if (code.includes('useState') || code.includes('useEffect')) return 'react-hooks';
    if (code.includes('<') && code.includes('>') && code.includes('function')) return 'typescript-generics';
    return null;
  }

  updateProgress(topic: string, progress: number): void {
    const path = this.paths.get(topic);
    if (path) {
      path.progress = Math.min(100, progress);
    }
  }

  getPaths(): LearningPath[] {
    return Array.from(this.paths.values());
  }

  async showDashboard(): Promise<void> {
    const paths = this.getPaths();
    let dashboard = '📚 Learning Paths\n\n';

    for (const path of paths) {
      const progress = '█'.repeat(Math.floor(path.progress / 10)) + '░'.repeat(10 - Math.floor(path.progress / 10));
      dashboard += `${path.topic} (${path.level})\n`;
      dashboard += `Progress: ${progress} ${path.progress}%\n`;
      dashboard += `ETA: ${path.estimatedTime}\n`;
      dashboard += `Next: ${path.nextSteps[0]}\n\n`;
    }

    vscode.window.showInformationMessage(dashboard);
  }
}

export async function showLearningPathUI(tracker: LearningPathTracker): Promise<void> {
  const paths = tracker.getPaths();
  const items = paths.map((p) => ({
    label: `${p.topic} (${p.progress}%)`,
    description: p.nextSteps[0],
  }));

  const selected = await vscode.window.showQuickPick(items);
  if (selected) {
    vscode.window.showInformationMessage(`📖 Learning: ${selected.label}`);
  }
}
