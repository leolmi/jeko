import type { FolderPicker } from '../folder-picker.js';
import type { TerminalOpener } from '../terminal.js';
import { linux, mac } from './posix.js';
import { windows } from './windows.js';

export type Os = 'win' | 'linux' | 'mac';

/**
 * Quello che cambia da un sistema all'altro: cartelle, processi, dialoghi, terminale e
 * aggiornamento dell'app. Il resto del codice passa da qui e non guarda `process.platform`.
 * Linux e macOS sono provvisori: macOS non è mai stato provato su un Mac vero.
 */
export interface Platform {
  os: Os;
  /** Cartella dei dati dell'utente, prima di `jeko/` (es. `%LOCALAPPDATA%`, `~/.local/share`). */
  dataHome(env: NodeJS.ProcessEnv): string;
  /** Eseguibile di Neutralino nella cartella dell'app. */
  appBinary: string;
  /** Cosa sostituisce un aggiornamento nella cartella dell'app. */
  appEntries: readonly string[];
  /** Chiave del pacchetto in `manifest.json` (`win-x64`, `linux-x64`…); null se non c'è. */
  packageKey: string | null;
  /** Istante di avvio di un processo (ms), se si riesce a leggerlo. */
  processStart(pid: number): number | null;
  /** Chiude il processo e i suoi figli. */
  killTree(pid: number): void;
  folderPicker: FolderPicker | undefined;
  terminal: TerminalOpener | undefined;
  /** Estrae il pacchetto di aggiornamento in `dest`. */
  extract(archive: string, dest: string): Promise<void>;
  /** Riapre l'app di `appDir` appena il processo `pid` è uscito. */
  relaunch(pid: number, appDir: string): void;
}

export function platformFor(p: NodeJS.Platform, arch: string = process.arch): Platform {
  if (p === 'win32') return windows;
  if (p === 'darwin') return mac;
  return linux(arch);
}

export const platform: Platform = platformFor(process.platform);
