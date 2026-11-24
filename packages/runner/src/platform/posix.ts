import { execFile, spawn, spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { FolderPicker } from '../folder-picker.js';
import { run as collect } from '../spawn.js';
import { isDir, launch, type TerminalOpener } from '../terminal.js';
import type { Platform } from './index.js';

const run = promisify(execFile);

/** Dopo SIGTERM, quanto si aspetta prima di SIGKILL. */
const KILL_GRACE_MS = 5000;

/** Parti comuni a Linux e macOS. */
const posix = {
  appBinary: 'jeko',
  appEntries: ['jeko', 'resources.neu', 'server', 'icon.png'],

  /** `ps` c'è su Linux e su macOS; in inglese (`LC_ALL=C`) la data si legge con Date.parse. */
  processStart(pid: number): number | null {
    const res = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf8',
      env: { ...process.env, LC_ALL: 'C' },
      timeout: 5000,
    });
    return res.status === 0 ? parsePsStart(res.stdout) : null;
  },

  /**
   * I processi che Jeko lancia sono capi del loro gruppo (`detached`): si chiude il gruppo,
   * prima con garbo e poi, se resiste, con SIGKILL.
   */
  killTree(pid: number): void {
    const signal = (sig: NodeJS.Signals) => {
      try {
        process.kill(-pid, sig);
        return true;
      } catch {
        try {
          process.kill(pid, sig);
          return true;
        } catch {
          return false; // già terminato
        }
      }
    };
    if (!signal('SIGTERM')) return;
    // Se il gruppo è già finito, kill fallisce e non succede niente.
    setTimeout(() => signal('SIGKILL'), KILL_GRACE_MS).unref();
  },

  async extract(archive: string, dest: string): Promise<void> {
    await run('tar', ['-xzf', archive, '-C', dest]);
  },

  /** Una shell staccata aspetta l'uscita del servizio (al massimo 2 minuti) e riapre l'app. */
  relaunch(pid: number, appDir: string): void {
    spawn('/bin/sh', ['-c', relaunchShell(pid, join(appDir, 'jeko'))], {
      cwd: appDir,
      detached: true,
      stdio: 'ignore',
    }).unref();
  },
};

/** Riga di `ps -o lstart=` (es. `Tue Nov  4 10:00:00 2026`, ora locale) in ms. */
export function parsePsStart(out: string): number | null {
  const s = out.trim().replace(/\s+/g, ' ');
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

/** Stringa tra apici singoli per sh. */
export const shQuote = (v: string) => `'${v.replaceAll("'", `'\\''`)}'`;

/** Script di `relaunch`: aspetta che `pid` esca e poi lancia `bin`. */
export function relaunchShell(pid: number, bin: string): string {
  return [
    'i=0',
    `while kill -0 ${pid} 2>/dev/null && [ "$i" -lt 240 ]; do sleep 0.5; i=$((i+1)); done`,
    `exec ${shQuote(bin)}`,
  ].join('\n');
}

/** zenity (GNOME e quasi tutti) o kdialog (KDE): il primo che c'è. */
export const linuxFolderPicker: FolderPicker = async ({ start, title }) => {
  const tries: string[][] = [
    [
      'zenity',
      '--file-selection',
      '--directory',
      ...(title ? ['--title', title] : []),
      ...(start ? [`--filename=${start.replace(/\/*$/, '/')}`] : []),
    ],
    ['kdialog', '--getexistingdirectory', start || homedir(), ...(title ? ['--title', title] : [])],
  ];
  for (const argv of tries) {
    const res = await collect(argv);
    if (res.code === -1 && /ENOENT/.test(res.stderr)) continue; // non installato
    if (res.code === 0) return res.stdout.trim() || null;
    if (res.code === 1) return null; // annullato
    throw new Error(res.stderr.trim() || `${argv[0]} è uscito con ${res.code}`);
  }
  throw new Error('Per il dialogo delle cartelle serve zenity o kdialog');
};

/** `choose folder` di AppleScript; annullare è l'errore -128. */
export const macFolderPicker: FolderPicker = async ({ start, title }) => {
  const script = [
    'on run argv',
    'set t to item 1 of argv',
    'set s to item 2 of argv',
    'if s is "" then',
    'return POSIX path of (choose folder with prompt t)',
    'end if',
    'return POSIX path of (choose folder with prompt t default location (POSIX file s))',
    'end run',
  ];
  const res = await collect([
    'osascript',
    ...script.flatMap((l) => ['-e', l]),
    title ?? '',
    start ?? '',
  ]);
  if (res.code === 0) return res.stdout.trim().replace(/(.)\/$/, '$1') || null;
  if (/-128/.test(res.stderr)) return null;
  throw new Error(res.stderr.trim() || `osascript è uscito con ${res.code}`);
};

/** Il terminale dell'utente nella cartella: il primo che si avvia. */
const linuxTerminal: TerminalOpener = async (cwd) => {
  if (!isDir(cwd)) throw new Error(`Cartella inesistente: ${cwd}`);
  const candidates = [
    process.env['TERMINAL'],
    'x-terminal-emulator',
    'gnome-terminal',
    'konsole',
    'xfce4-terminal',
    'kitty',
    'alacritty',
    'xterm',
  ].filter((c): c is string => !!c);
  for (const term of candidates) {
    try {
      return await launch(term, [], cwd);
    } catch {
      /* non c'è: il prossimo */
    }
  }
  throw new Error('Nessun terminale trovato (imposta la variabile TERMINAL)');
};

export function linux(arch: string): Platform {
  return {
    ...posix,
    os: 'linux',
    dataHome: (env) => env['XDG_DATA_HOME'] || join(homedir(), '.local', 'share'),
    packageKey: arch === 'x64' ? 'linux-x64' : arch === 'arm64' ? 'linux-arm64' : null,
    folderPicker: linuxFolderPicker,
    terminal: linuxTerminal,
  };
}

export const mac: Platform = {
  ...posix,
  os: 'mac',
  dataHome: () => join(homedir(), 'Library', 'Application Support'),
  packageKey: 'mac-universal',
  folderPicker: macFolderPicker,
  terminal: async (cwd) => {
    if (!isDir(cwd)) throw new Error(`Cartella inesistente: ${cwd}`);
    await launch('open', ['-a', 'Terminal', cwd], cwd);
  },
};
