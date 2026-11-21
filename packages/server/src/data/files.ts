import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** Cartella dei dati: `JEKO_DATA_DIR` o `%LOCALAPPDATA%\jeko\data`. */
export function defaultDataDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env['JEKO_DATA_DIR']) return env['JEKO_DATA_DIR'];
  const base = env['LOCALAPPDATA'] ?? join(homedir(), '.local', 'share');
  return join(base, 'jeko', 'data');
}

/** Scrittura atomica: file temporaneo, fsync, rinomina. Un PC spento a metà lascia il vecchio. */
export function writeAtomic(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  const fd = openSync(tmp, 'w');
  try {
    writeSync(fd, content);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, file);
}

export function writeJson(file: string, value: unknown): void {
  writeAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}

/** JSON del file, o `fallback` se manca. Un file illeggibile è un errore: meglio fermarsi. */
export function readJson<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback;
  return JSON.parse(readFileSync(file, 'utf8')) as T;
}

/** Aggiunge una riga in fondo al file (con fsync). */
export function appendLine(file: string, line: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const fd = openSync(file, 'a');
  try {
    writeSync(fd, `${line}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/**
 * Righe JSON di un file `.jsonl`. Un'ultima riga troncata (PC spento a metà scrittura) si
 * scarta; una riga illeggibile in mezzo no, è un file rovinato.
 */
export function readLines<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, 'utf8').split('\n');
  const out: T[] = [];
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    try {
      out.push(JSON.parse(line) as T);
    } catch (e) {
      if (i < lines.length - 1 && lines.slice(i + 1).some((l) => l.trim())) throw e;
    }
  });
  return out;
}

/** Ora attuale in ISO 8601 UTC con millisecondi, come le date dell'API. */
export const now = () => new Date().toISOString();

/** Impostazioni chiave → valore in `settings.json`, tenute in memoria. */
export class SettingsFile {
  private readonly file: string;
  private values: Record<string, unknown>;

  constructor(dataDir: string) {
    this.file = join(dataDir, 'settings.json');
    this.values = readJson<Record<string, unknown>>(this.file, {});
  }

  get<T>(key: string): T | undefined {
    return this.values[key] as T | undefined;
  }

  set(key: string, value: unknown): void {
    this.values = { ...this.values, [key]: value };
    writeJson(this.file, this.values);
  }

  delete(key: string): void {
    if (!(key in this.values)) return;
    const { [key]: _, ...rest } = this.values;
    this.values = rest;
    writeJson(this.file, this.values);
  }
}
