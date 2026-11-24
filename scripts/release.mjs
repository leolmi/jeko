// Pubblica i pacchetti di `npm run package` come release GitHub v<versione> del repository
// (GitHub CLI, `gh auth login`): le app installate la trovano come ultima release. Con loro
// va anche install.sh, l'installazione per Linux e macOS.
// Note: `npm run release -- "testo"`, altrimenti l'oggetto dell'ultimo commit.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = join(root, 'release');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const manifestPath = join(releaseDir, 'manifest.json');
if (!existsSync(manifestPath))
  throw new Error('manca release/manifest.json: esegui prima "npm run package"');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest.version !== version)
  throw new Error(
    `release/ ha la versione ${manifest.version}, package.json ${version}: rifai "npm run package"`,
  );
const assets = Object.values(manifest.packages ?? { win: manifest.package }).map((p) =>
  join(releaseDir, p.name),
);
for (const a of assets) if (!existsSync(a)) throw new Error(`manca ${a}: rifai "npm run package"`);
const installSh = join(root, 'install.sh');
const lf = join(releaseDir, 'install.sh');
// Con CRLF (core.autocrlf) sh non lo legge.
writeFileSync(lf, readFileSync(installSh, 'utf8').replace(/\r\n/g, '\n'));

const run = (cmd, args) =>
  execFileSync(cmd, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim();
try {
  run('gh', ['--version']);
} catch {
  throw new Error(
    'GitHub CLI non trovato: installalo ("winget install GitHub.cli") e fai "gh auth login"',
  );
}
const notes = process.argv[2] ?? run('git', ['log', '-1', '--format=%s']);
const tag = `v${version}`;
console.log(
  run('gh', [
    'release',
    'create',
    tag,
    ...assets,
    manifestPath,
    lf,
    '--title',
    `Jeko ${version}`,
    '--notes',
    notes,
    '--target',
    run('git', ['rev-parse', 'HEAD']),
  ]),
);
