import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const shared = fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url));

export default defineConfig({
  resolve: { alias: { '@jeko/shared': shared } },
  test: {
    projects: [
      ...['packages/shared', 'packages/server', 'packages/runner'].map((dir) => ({
        extends: true,
        test: {
          name: dir.split('/')[1]!,
          root: dir,
          include: ['src/**/*.test.ts'],
          // Ogni test del server avvia PGlite (WASM): con la suite in parallelo supera i 5 s.
          ...(dir === 'packages/server' && { testTimeout: 15_000 }),
        },
      })),
      // Server e runner insieme: server reale (PGlite) e runner reale con claude finto.
      {
        extends: true,
        test: { name: 'e2e', root: 'tests/e2e', include: ['**/*.test.ts'], testTimeout: 15_000 },
      },
    ],
  },
});
