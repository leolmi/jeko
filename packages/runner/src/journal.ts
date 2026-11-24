import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  truncateSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';
import type { RunEvent } from '@jeko/shared';
import { platform } from './platform/index.js';

export interface JournalEntry {
  seq: number;
  event: RunEvent;
}

const EVENTS = 'events.jsonl';
const ACK = 'ack.json';

/** Cartella dei dati del runner: `JEKO_RUNNER_DATA`, altrimenti `%LOCALAPPDATA%\jeko\runner`. */
export function defaultDataDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env['JEKO_RUNNER_DATA']) return env['JEKO_RUNNER_DATA'];
  return join(platform.dataHome(env), 'jeko', 'runner');
}

/** Scrittura atomica: file temporaneo, fsync, rinomina. */
export function writeAtomic(file: string, content: string): void {
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

/**
 * Giornale di una run sul PC: eventi numerati scritti su disco (con fsync) prima dell'invio.
 * Dopo una riconnessione o un riavvio del runner si reinvia ciò che il server non ha confermato.
 */
export class RunJournal {
  private entries: JournalEntry[] = [];
  private acked = 0;
  private last = 0;
  private lastEvent: RunEvent | undefined;

  constructor(readonly dir: string) {
    mkdirSync(dir, { recursive: true });
    this.load();
  }

  get lastSeq(): number {
    return this.last;
  }

  get ackedSeq(): number {
    return this.acked;
  }

  /** Scrive l'evento e ne restituisce il numero. */
  append(event: RunEvent): JournalEntry {
    const entry = { seq: this.last + 1, event };
    const fd = openSync(join(this.dir, EVENTS), 'a');
    try {
      writeSync(fd, `${JSON.stringify(entry)}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    this.last = entry.seq;
    this.lastEvent = event;
    this.entries.push(entry);
    return entry;
  }

  unacked(): JournalEntry[] {
    return this.entries.filter((e) => e.seq > this.acked);
  }

  ack(seq: number): void {
    if (seq <= this.acked) return;
    this.acked = Math.min(seq, this.last);
    writeAtomic(join(this.dir, ACK), JSON.stringify({ acked: this.acked }));
    this.entries = this.entries.filter((e) => e.seq > this.acked);
  }

  /** La run è chiusa e il server ha tutto. */
  get settled(): boolean {
    return this.acked === this.last && this.last > 0 && this.lastEvent?.type === 'run.finished';
  }

  remove(): void {
    rmSync(this.dir, { recursive: true, force: true });
  }

  private load(): void {
    const ackFile = join(this.dir, ACK);
    if (existsSync(ackFile)) {
      try {
        this.acked = (JSON.parse(readFileSync(ackFile, 'utf8')) as { acked: number }).acked;
      } catch {
        this.acked = 0;
      }
    }
    const file = join(this.dir, EVENTS);
    if (!existsSync(file)) return;
    const text = readFileSync(file, 'utf8');
    let valid = 0; // byte delle righe integre
    for (const line of text.split('\n')) {
      const bytes = Buffer.byteLength(line, 'utf8') + 1;
      if (!line.trim()) {
        valid += bytes;
        continue;
      }
      let entry: JournalEntry;
      try {
        entry = JSON.parse(line) as JournalEntry;
      } catch {
        break; // riga troncata (PC spento a metà scrittura): da qui si scarta
      }
      if (entry.seq !== this.last + 1) break;
      valid += bytes;
      this.last = entry.seq;
      this.lastEvent = entry.event;
      if (entry.seq > this.acked) this.entries.push(entry);
    }
    const size = Buffer.byteLength(text, 'utf8');
    if (valid < size) truncateSync(file, valid);
    this.acked = Math.min(this.acked, this.last);
  }
}

/** Giornali di tutte le run, in `<dataDir>/runs/<runId>/`. */
export class Journals {
  private readonly open = new Map<string, RunJournal>();

  constructor(readonly dataDir: string) {}

  runDir(runId: string): string {
    return join(this.dataDir, 'runs', runId);
  }

  get(runId: string): RunJournal {
    let j = this.open.get(runId);
    if (!j) {
      j = new RunJournal(this.runDir(runId));
      this.open.set(runId, j);
    }
    return j;
  }

  append(runId: string, event: RunEvent): JournalEntry {
    return this.get(runId).append(event);
  }

  /** Run con un giornale su disco. */
  runIds(): string[] {
    const dir = join(this.dataDir, 'runs');
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  }

  /** Toglie il giornale di una run chiusa e confermata (non attiva nel runner). */
  dropIfSettled(runId: string): void {
    const j = this.get(runId);
    if (!j.settled) return;
    this.open.delete(runId);
    j.remove();
  }
}
