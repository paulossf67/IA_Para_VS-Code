import * as path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // 'vscode' é injetado pelo editor em runtime e não resolve sob vitest
      vscode: path.resolve(__dirname, 'test/vscode-mock.ts'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'out/',
        '**/*.test.ts',
      ],
    },
  },
});
