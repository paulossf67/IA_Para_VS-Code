import { EventEmitter } from 'events';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ spawn: vi.fn() }));

vi.mock('child_process', () => ({ spawn: mocks.spawn }));

import { getValidationScripts, runNpmScript } from './projectValidation';

class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn();
}

afterEach(() => vi.clearAllMocks());

describe('project validation', () => {
  it('detects only supported finite validation scripts', () => {
    expect(getValidationScripts(JSON.stringify({
      scripts: {
        test: 'vitest run',
        compile: 'tsc -p .',
        'test:watch': 'vitest',
        start: 'vite',
        lint: '',
      },
    }))).toEqual(['test', 'compile']);
    expect(getValidationScripts('invalid json')).toEqual([]);
  });

  it('runs an allowlisted script and captures its output', async () => {
    const child = new FakeChild();
    mocks.spawn.mockReturnValue(child);

    const resultPromise = runNpmScript('test', 'C:\\workspace', 1000);
    child.stdout.emit('data', 'tests passed');
    child.stderr.emit('data', 'one warning');
    child.emit('close', 0);
    const result = await resultPromise;

    expect(mocks.spawn).toHaveBeenCalledWith(
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['run', 'test'],
      expect.objectContaining({ cwd: 'C:\\workspace' })
    );
    expect(result).toEqual({ exitCode: 0, output: 'tests passedone warning', timedOut: false });
  });

  it('rejects scripts outside the validation allowlist', async () => {
    await expect(runNpmScript('deploy', 'C:\\workspace')).rejects.toThrow(/não permitido/);
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
});