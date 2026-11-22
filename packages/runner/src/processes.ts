import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { TaskProcess } from '@jeko/shared';
import { writeAtomic } from './journal.js';
import type { ProcessRequest, ProcessResponse } from './permissions/protocol.js';
import { killTree, sameProcess } from './process.js';

/** Avvia un processo che sopravvive al turno di claude (per una run già scelta). */
export type ProcessStarter = (req: ProcessRequest) => Promise<ProcessResponse>;

interface Entry {
  pid: number;
  startedAt: number;
  command: string;
  cwd: string;
  log: string;
}

const LIST = 'processes.json';

function tail(file: string, lines = 20): string {
  try {
    return readFileSync(file, 'utf8').trimEnd().split('\n').slice(-lines).join('\n');
  } catch {
    return '';
  }
}

/**
 * Processi avviati da claude per restare attivi dopo il turno (server di sviluppo e simili).
 * Partono dal runner, non da claude: chiudere claude a fine turno non li tocca. Restano
 * registrati su disco per run (anche dopo un riavvio) e si chiudono quando la run finisce.
 */
export class ProcessRegistry {
  constructor(
    private readonly dir: string,
    /** Attesa dopo l'avvio per capire se il processo è uscito subito. */
    private readonly settleMs = 2000,
  ) {}

  private runDir = (runId: string) => join(this.dir, runId);

  list(runId: string): Entry[] {
    try {
      return JSON.parse(readFileSync(join(this.runDir(runId), LIST), 'utf8')) as Entry[];
    } catch {
      return [];
    }
  }

  async start(runId: string, req: ProcessRequest & { cwd: string }): Promise<ProcessResponse> {
    const dir = this.runDir(runId);
    mkdirSync(dir, { recursive: true });
    const entries = this.list(runId);
    const log = join(dir, `${entries.length + 1}.log`);
    const fd = openSync(log, 'a');
    let child;
    try {
      child = spawn(req.command, {
        cwd: req.cwd,
        shell: true,
        // Altrove serve per chiuderne il gruppo; su Windows i figli sopravvivono comunque al
        // padre, e con `detached` i processi lanciati dalla shell perdono l'uscita sul log.
        detached: process.platform !== 'win32',
        windowsHide: true,
        stdio: ['ignore', fd, fd],
      });
    } finally {
      closeSync(fd);
    }
    let exitCode: number | null | undefined;
    child.once('exit', (code) => (exitCode = code));
    await new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    const pid = child.pid!;
    entries.push({ pid, startedAt: Date.now(), command: req.command, cwd: req.cwd, log });
    writeAtomic(join(dir, LIST), JSON.stringify(entries));
    child.unref();

    await new Promise((r) => setTimeout(r, this.settleMs));
    const running = exitCode === undefined;
    return {
      pid,
      log,
      running,
      ...(!running && { exitCode: exitCode ?? null }),
      output: tail(log),
    };
  }

  /** Processi della run, con quali sono ancora vivi (il PID è ancora il loro). */
  status(runId: string): TaskProcess[] {
    return this.list(runId).map((e) => ({
      pid: e.pid,
      command: e.command,
      cwd: e.cwd,
      log: e.log,
      startedAt: new Date(e.startedAt).toISOString(),
      alive: sameProcess(e.pid, e.startedAt),
    }));
  }

  /** Chiude i processi della run ancora vivi, a task aperto: registro e log restano. */
  stop(runId: string): TaskProcess[] {
    return this.status(runId).map((p) => {
      if (!p.alive) return p;
      killTree(p.pid);
      return { ...p, alive: false };
    });
  }

  /** Chiude i processi della run ancora vivi (se il PID è ancora il loro) e ne toglie i log. */
  stopRun(runId: string): void {
    const dir = this.runDir(runId);
    if (!existsSync(dir)) return;
    this.stop(runId);
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // un log ancora aperto: resta, senza conseguenze
    }
  }
}
