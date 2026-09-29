import { spawn } from 'child_process';

export const VALIDATION_SCRIPTS = ['test', 'test:unit', 'compile', 'build', 'lint', 'typecheck', 'check'] as const;
const MAX_OUTPUT_CHARS = 24000;
const DEFAULT_TIMEOUT_MS = 120000;

export interface ValidationResult {
  exitCode: number | null;
  output: string;
  timedOut: boolean;
}

export function getValidationScripts(packageJson: string): string[] {
  try {
    const parsed: unknown = JSON.parse(packageJson);
    if (!parsed || typeof parsed !== 'object' || !('scripts' in parsed)) return [];
    const scripts = (parsed as { scripts?: Record<string, unknown> }).scripts;
    if (!scripts || typeof scripts !== 'object') return [];
    return VALIDATION_SCRIPTS.filter((name) =>
      typeof scripts[name] === 'string' && scripts[name].trim().length > 0
    );
  } catch {
    return [];
  }
}

export function runNpmScript(
  script: string,
  cwd: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<ValidationResult> {
  if (!VALIDATION_SCRIPTS.includes(script as (typeof VALIDATION_SCRIPTS)[number])) {
    return Promise.reject(new Error('Script de validação não permitido.'));
  }

  return new Promise((resolve) => {
    const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const child = spawn(command, ['run', script], {
      cwd,
      shell: process.platform === 'win32',
      windowsHide: true,
    });
    let output = '';
    let timedOut = false;
    let settled = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    const appendOutput = (chunk: unknown) => {
      output = `${output}${String(chunk)}`.slice(-MAX_OUTPUT_CHARS);
    };
    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      if (timeoutHandle) clearTimeout(timeoutHandle);
      resolve({ exitCode, output, timedOut });
    };

    child.stdout?.on('data', appendOutput);
    child.stderr?.on('data', appendOutput);
    child.once('error', (error) => {
      appendOutput(error.message);
      finish(null);
    });
    child.once('close', (code) => finish(code));
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill();
      finish(null);
    }, timeoutMs);
  });
}