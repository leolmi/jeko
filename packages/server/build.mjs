// Bundle unico del servizio: dist/jeko.js (API, web-app, runner, script dei permessi), con
// dentro versione, workflow e template di serie. Node è l'unico prerequisito.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';

const root = join(import.meta.dirname, '..', '..');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const read = (dir, ext) => {
  const path = join(root, 'packages', 'shared', dir);
  return readdirSync(path)
    .filter((f) => f.endsWith(ext))
    .sort()
    .map((f) => readFileSync(join(path, f), 'utf8'));
};

await build({
  entryPoints: [join(import.meta.dirname, 'src', 'main.ts')],
  outfile: join(import.meta.dirname, 'dist', 'jeko.js'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: 'linked',
  // Moduli nativi facoltativi di ws: senza, ws usa il codice JavaScript.
  external: ['bufferutil', 'utf-8-validate'],
  define: {
    __JEKO_VERSION__: JSON.stringify(version),
    __JEKO_BUILTIN__: JSON.stringify({
      workflows: read('workflows', '.yaml'),
      templates: read('templates', '.md'),
    }),
  },
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  logLevel: 'warning',
});
console.log(`dist/jeko.js ${version}`);
