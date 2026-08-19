import path from 'node:path';
import { defineConfig } from 'vitest/config';

const repoRoot = __dirname;

const fromRoot = (...parts: string[]) => path.resolve(repoRoot, ...parts);

export default defineConfig({
  resolve: {
    alias: [
      { find: '@formulang/definitions', replacement: fromRoot('definitions/src/index.ts') },
      { find: '@formulang/parser', replacement: fromRoot('parser/src/index.ts') },
      {
        find: '@formulang/core-functions',
        replacement: fromRoot('core-functions/src/index.ts'),
      },
      { find: '@formulang/runner', replacement: fromRoot('runner/src/index.ts') },
    ],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.spec.ts', '**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
