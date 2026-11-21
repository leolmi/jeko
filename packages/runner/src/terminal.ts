import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';

/** Apre sul PC un terminale nella cartella data (es. per un login o dati sensibili). */
export type TerminalOpener = (cwd: string) => Promise<void>;

/**
 * Windows Terminal nella cartella, o PowerShell in una finestra nuova se manca. Il terminale è
 * dell'utente: quello che ci scrive non passa né da Jeko né da claude.
 */
export function systemTerminal(): TerminalOpener | undefined {
  if (process.platform !== 'win32') return undefined;
  return async (cwd) => {
    if (!isDir(cwd)) throw new Error(`Cartella inesistente: ${cwd}`);
    try {
      await launch('wt.exe', ['-d', '.'], cwd);
    } catch {
      const cmd = process.env['ComSpec'] ?? 'cmd.exe';
      await launch(cmd, ['/d /c start "" powershell.exe -NoExit -NoLogo'], cwd, true);
    }
  };
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Lancia il programma staccato dal runner; fallisce se non si avvia (es. non installato). */
function launch(file: string, args: string[], cwd: string, verbatim = false): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd,
      detached: true,
      stdio: 'ignore',
      windowsVerbatimArguments: verbatim,
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}
