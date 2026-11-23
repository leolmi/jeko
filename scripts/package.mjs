// Cartella portabile dell'app, release/jeko (nessuna installazione: si copia dove si vuole):
//   jeko.exe        Neutralino (da `neu build`)
//   resources.neu   pagina d'avvio della finestra
//   server/jeko.js  servizio (bundle unico: API, runner, script dei permessi)
//   server/admin/   web-app, servita dal servizio
//   server/relay/   pagina remota, servita dal relay su questo PC
// Scrive anche il pacchetto di aggiornamento pubblicato come release GitHub (npm run release):
// release/jeko-<versione>-win-x64.zip con tutto quanto sopra e release/manifest.json.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = join(root, 'release');
const out = join(releaseDir, 'jeko');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const neu = JSON.parse(readFileSync(join(root, 'neutralino.config.json'), 'utf8'));
if (neu.version !== pkg.version)
  throw new Error(
    `neutralino.config.json ha la versione ${neu.version}, package.json ${pkg.version}`,
  );

const files = [
  ['dist/jeko/jeko-win_x64.exe', 'jeko.exe'],
  ['dist/jeko/resources.neu', 'resources.neu'],
  ['packages/server/dist/jeko.js', 'server/jeko.js'],
  ['packages/admin/dist/admin/browser', 'server/admin'],
  ['packages/relay/public', 'server/relay'],
];
for (const [from] of files)
  if (!existsSync(join(root, from)))
    throw new Error(`manca ${from}: esegui prima "npm run build" e "neu build"`);

rmSync(out, { recursive: true, force: true });
for (const [from, to] of files) {
  mkdirSync(dirname(join(out, to)), { recursive: true });
  cpSync(join(root, from), join(out, to), { recursive: true });
}
console.log(`cartella portabile pronta: ${out}`);

for (const old of readdirSync(releaseDir).filter((n) => /^jeko-.*-win-x64\.zip$/.test(n)))
  rmSync(join(releaseDir, old));
const zipName = `jeko-${pkg.version}-win-x64.zip`;
const zipPath = join(releaseDir, zipName);
// tar.exe di Windows (10 e successivi) scrive anche gli zip; quello di Git Bash no.
const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
execFileSync(tar, ['-a', '-c', '-f', zipPath, '-C', out, 'jeko.exe', 'resources.neu', 'server']);
const zip = readFileSync(zipPath);
const manifest = {
  version: pkg.version,
  package: {
    name: zipName,
    size: zip.length,
    sha256: createHash('sha256').update(zip).digest('hex'),
  },
};
writeFileSync(join(releaseDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `pacchetto di aggiornamento pronto: ${zipPath} (${(zip.length / 1048576).toFixed(1)} MB)`,
);
