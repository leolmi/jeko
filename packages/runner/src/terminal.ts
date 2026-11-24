import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';

/** Apre sul PC un terminale nella cartella data (es. per un login o dati sensibili). */
export type TerminalOpener = (cwd: string) => Promise<void>;

export function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Lancia il programma staccato dal runner; fallisce se non si avvia (es. non installato). */
export function launch(file: string, args: string[], cwd: string, verbatim = false): Promise<void> {
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
