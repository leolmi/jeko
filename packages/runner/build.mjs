import { build } from 'esbuild';

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
};

await Promise.all([
  build({ ...common, entryPoints: ['src/index.ts'], outfile: 'dist/runner.js' }),
  build({ ...common, entryPoints: ['src/mcp-main.ts'], outfile: 'dist/mcp.js' }),
  build({ ...common, entryPoints: ['src/hook-main.ts'], outfile: 'dist/hook.js' }),
]);
