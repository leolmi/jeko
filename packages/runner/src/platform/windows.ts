import { execFile, spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { windowsFolderPicker } from '../folder-picker.js';
import { isDir, launch } from '../terminal.js';
import type { Platform } from './index.js';

const run = promisify(execFile);

export const windows: Platform = {
  os: 'win',
  dataHome: (env) => env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local'),
  appBinary: 'jeko.exe',
  appEntries: ['jeko.exe', 'resources.neu', 'server'],
  packageKey: 'win-x64',

  processStart(pid) {
    const res = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')`,
      ],
      { encoding: 'utf8', windowsHide: true, timeout: 10_000 },
    );
    const t = Date.parse(res.stdout.trim());
    return Number.isNaN(t) ? null : t;
  },

  // Su Windows i figli non muoiono con il padre.
  killTree(pid) {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
  },

  folderPicker: windowsFolderPicker,

  /**
   * Windows Terminal nella cartella, o PowerShell in una finestra nuova se manca. Il terminale è
   * dell'utente: quello che ci scrive non passa né da Jeko né da claude.
   */
  async terminal(cwd) {
    if (!isDir(cwd)) throw new Error(`Cartella inesistente: ${cwd}`);
    try {
      await launch('wt.exe', ['-d', '.'], cwd);
    } catch {
      const cmd = process.env['ComSpec'] ?? 'cmd.exe';
      await launch(cmd, ['/d /c start "" powershell.exe -NoExit -NoLogo'], cwd, true);
    }
  },

  async extract(archive, dest) {
    // tar.exe di Windows (10 e successivi) apre anche gli zip; quello di Git, se nel PATH, no.
    const tar = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'tar.exe');
    await run(tar, ['-xf', archive, '-C', dest], { windowsHide: true });
  },

  /**
   * Uno script PowerShell avviato con `cmd /c start`: lanciato direttamente da Node, con
   * `detached` PowerShell esce subito senza far niente, e senza muore insieme al servizio.
   */
  relaunch(pid, appDir) {
    const dir = join(tmpdir(), 'jeko-update');
    mkdirSync(dir, { recursive: true });
    const script = join(dir, 'relaunch.ps1');
    // Con il BOM PowerShell 5.1 legge l'UTF-8 (percorsi con lettere accentate).
    writeFileSync(script, `\uFEFF${relaunchScript(pid, appDir)}`, 'utf8');
    spawn(
      'cmd.exe',
      [
        '/d',
        '/c',
        `start "" /min powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${script}"`,
      ],
      { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true },
    ).unref();
  },
};

/** Script che aspetta la fine del processo `pid` e poi riapre `jeko.exe` da `appDir`. */
export function relaunchScript(pid: number, appDir: string): string {
  const q = (v: string) => `'${v.replaceAll("'", "''")}'`;
  return [
    `Wait-Process -Id ${pid} -Timeout 120 -ErrorAction SilentlyContinue`,
    `Start-Process -FilePath ${q(join(appDir, 'jeko.exe'))} -WorkingDirectory ${q(appDir)}`,
    '',
  ].join('\r\n');
}
