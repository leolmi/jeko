// Cartella portabile dell'app per Windows, release/jeko (nessuna installazione: si copia dove si vuole):
//   jeko.exe        Neutralino (da `neu build`)
//   resources.neu   pagina d'avvio della finestra
//   server/jeko.js  servizio (bundle unico: API, runner, script dei permessi)
//   server/admin/   web-app, servita dal servizio
//   server/relay/   pagina remota, servita dal relay su questo PC
// Scrive anche i pacchetti di aggiornamento pubblicati come release GitHub (npm run release),
// uno per sistema, e release/manifest.json:
//   jeko-<versione>-win-x64.zip          come la cartella qui sopra
//   jeko-<versione>-<linux-x64|linux-arm64|mac-universal>.tar.gz
//                                        con `jeko`, server/service.sh e icon.png in più
// I pacchetti Linux e macOS si fanno solo se `neu build` ha i loro eseguibili (`npx neu update`
// li scarica tutti). macOS è provvisorio: non è mai stato provato su un Mac vero.
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
import { collect, tarGz } from './tar.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = join(root, 'release');
const out = join(releaseDir, 'jeko');
const dist = join(root, 'dist', 'jeko');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const neu = JSON.parse(readFileSync(join(root, 'neutralino.config.json'), 'utf8'));
if (neu.version !== pkg.version)
  throw new Error(
    `neutralino.config.json ha la versione ${neu.version}, package.json ${pkg.version}`,
  );

/** Uguale per tutti i sistemi: `[percorso nel pacchetto, sorgente]`. */
const common = [
  ['resources.neu', 'dist/jeko/resources.neu'],
  ['server/jeko.js', 'packages/server/dist/jeko.js'],
  ['server/admin', 'packages/admin/dist/admin/browser'],
  ['server/relay', 'packages/relay/public'],
];
for (const [, from] of [...common, ['', 'dist/jeko/jeko-win_x64.exe']])
  if (!existsSync(join(root, from)))
    throw new Error(`manca ${from}: esegui prima "npm run build" e "neu build"`);

// ---------- Windows: cartella portabile e zip ----------

rmSync(out, { recursive: true, force: true });
for (const [to, from] of [['jeko.exe', 'dist/jeko/jeko-win_x64.exe'], ...common]) {
  mkdirSync(dirname(join(out, to)), { recursive: true });
  cpSync(join(root, from), join(out, to), { recursive: true });
}
console.log(`cartella portabile pronta: ${out}`);

for (const old of readdirSync(releaseDir).filter((n) => /^jeko-.*\.(zip|tar\.gz)$/.test(n)))
  rmSync(join(releaseDir, old));

const packages = {};
const done = (key, name) => {
  const data = readFileSync(join(releaseDir, name));
  packages[key] = {
    name,
    size: data.length,
    sha256: createHash('sha256').update(data).digest('hex'),
  };
  console.log(`pacchetto ${key}: ${name} (${(data.length / 1048576).toFixed(1)} MB)`);
};

const zipName = `jeko-${pkg.version}-win-x64.zip`;
// tar.exe di Windows (10 e successivi) scrive anche gli zip; quello di Git Bash no.
const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
execFileSync(tar, [
  '-a',
  '-c',
  '-f',
  join(releaseDir, zipName),
  '-C',
  out,
  'jeko.exe',
  'resources.neu',
  'server',
]);
done('win-x64', zipName);

// ---------- Linux e macOS: tar.gz con i permessi ----------

const posix = [
  ['linux-x64', 'jeko-linux_x64'],
  ['linux-arm64', 'jeko-linux_arm64'],
  ['mac-universal', 'jeko-mac_universal'],
];
// Con CRLF (core.autocrlf) sh non lo legge: lo script va sempre con LF.
const tmp = join(releaseDir, '.tmp');
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
const serviceSh = join(tmp, 'service.sh');
writeFileSync(
  serviceSh,
  readFileSync(join(root, 'packages/server/service.sh'), 'utf8').replace(/\r\n/g, '\n'),
);
for (const [key, bin] of posix) {
  if (!existsSync(join(dist, bin))) {
    console.warn(`pacchetto ${key} saltato: manca dist/jeko/${bin} (npx neu update)`);
    continue;
  }
  const name = `jeko-${pkg.version}-${key}.tar.gz`;
  const entries = collect([
    ['jeko', join(dist, bin), 0o755],
    ...common.map(([to, from]) => [to, join(root, from)]),
    ['server/service.sh', serviceSh, 0o755],
    ['icon.png', join(root, 'desktop/icon.png')],
  ]);
  writeFileSync(join(releaseDir, name), tarGz(entries));
  done(key, name);
}
rmSync(tmp, { recursive: true, force: true });

const manifest = {
  version: pkg.version,
  // Le versioni fino alla 0.2.2 leggono solo `package`, quello di Windows.
  package: packages['win-x64'],
  packages,
};
writeFileSync(join(releaseDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log('release/manifest.json pronto');
