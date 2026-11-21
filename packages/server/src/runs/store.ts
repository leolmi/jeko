import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  FINAL_STATUSES,
  type Answer,
  type Prompt,
  type PromptRecord,
  type RunDetail,
  type RunEvent,
  type RunEventRecord,
  type RunMode,
  type RunRowStatus,
  type RunState,
  type RunSummary,
  type Workflow,
} from '@jeko/shared';
import { appendLine, now, readJson, readLines, writeJson } from '../data/files.js';

export interface NewRun {
  workflow: string;
  version: number;
  request: string;
  mode: RunMode;
  inputs?: Record<string, string> | undefined;
  cwd?: string | undefined;
  /** Definizione con cui la run parte e riparte, anche se il workflow viene eliminato. */
  definition?: Workflow | undefined;
}

/** Dati per (ri)avviare una run sul runner. */
export interface RunLaunch {
  id: string;
  workflow: string;
  version: number;
  request: string;
  mode: RunMode;
  status: RunRowStatus;
  inputs: Record<string, string> | null;
  cwd: string | null;
  state: RunState | null;
  definition: Workflow | null;
}

/** Contenuto di `runs/<id>/run.json`: la run con le sue richieste all'utente. */
export interface RunFile extends Omit<RunSummary, 'usage'> {
  inputs: Record<string, string> | null;
  state: RunState | null;
  definition: Workflow | null;
  prompts: (PromptRecord & { answeredAt?: string })[];
}

/** Riga di `runs/<id>/events.jsonl`. */
export interface EventLine extends RunEventRecord {
  /** Numero dell'evento nel giornale del runner: un reinvio non crea doppioni. */
  runnerSeq: number;
}

const RUN = 'run.json';
const EVENTS = 'events.jsonl';

const summary = ({
  inputs: _i,
  state,
  definition: _d,
  prompts: _p,
  ...run
}: RunFile): RunSummary => ({
  ...run,
  usage: state?.usage ?? null,
});

const publicPrompt = ({ answeredAt: _, ...p }: RunFile['prompts'][number]): PromptRecord => p;

/**
 * Run su file: una cartella per run con `run.json` (stato e richieste) ed `events.jsonl`
 * (eventi in coda). Le run stanno in memoria; gli eventi si leggono quando servono.
 */
export class RunStore {
  private readonly dir: string;
  private readonly runs = new Map<string, RunFile>();
  /** Per run: ultimo numero di evento e numeri del runner già visti (caricati al primo uso). */
  private readonly seqs = new Map<string, { last: number; runner: Set<number> }>();

  constructor(dataDir: string) {
    this.dir = join(dataDir, 'runs');
    if (!existsSync(this.dir)) return;
    for (const d of readdirSync(this.dir, { withFileTypes: true })) {
      if (!d.isDirectory() || !existsSync(join(this.dir, d.name, RUN))) continue;
      const run = readJson<RunFile>(join(this.dir, d.name, RUN), null as never);
      this.runs.set(run.id, run);
    }
  }

  /** Cartella di una run (anche per lo script di migrazione). */
  static runDir(dataDir: string, id: string): string {
    return join(dataDir, 'runs', id);
  }

  async create(run: NewRun): Promise<RunSummary> {
    const at = now();
    const file: RunFile = {
      id: randomUUID(),
      workflow: run.workflow,
      version: run.version,
      request: run.request,
      mode: run.mode,
      status: 'queued',
      error: null,
      cwd: run.cwd ?? null,
      inputs: run.inputs ?? null,
      state: null,
      definition: run.definition ?? null,
      prompts: [],
      createdAt: at,
      updatedAt: at,
    };
    this.write(file);
    return summary(file);
  }

  async list(limit = 200): Promise<RunSummary[]> {
    return [...this.runs.values()]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
      .slice(0, limit)
      .map(summary);
  }

  /** Run attive: in coda o al lavoro (quelle ferme a una richiesta all'utente no). */
  get activeCount(): number {
    return [...this.runs.values()].filter((r) => r.status === 'queued' || r.status === 'running')
      .length;
  }

  /** Elimina le run concluse fra quelle date (eventi e richieste vanno con loro); gli id tolti. */
  async remove(ids: string[]): Promise<string[]> {
    const removed: string[] = [];
    for (const id of ids) {
      const run = this.runs.get(id);
      if (!run || !FINAL_STATUSES.includes(run.status)) continue;
      rmSync(join(this.dir, id), { recursive: true, force: true });
      this.runs.delete(id);
      this.seqs.delete(id);
      removed.push(id);
    }
    return removed;
  }

  async get(id: string): Promise<RunSummary | null> {
    const run = this.runs.get(id);
    return run ? summary(run) : null;
  }

  async detail(id: string): Promise<RunDetail | null> {
    const run = this.runs.get(id);
    if (!run) return null;
    const events = readLines<EventLine>(join(this.dir, id, EVENTS)).map(
      ({ runnerSeq: _, ...e }) => e,
    );
    return { ...summary(run), events, prompts: run.prompts.map(publicPrompt) };
  }

  /** Run da avviare o riprendere all'avvio del runner. */
  async launchable(): Promise<RunLaunch[]> {
    return [...this.runs.values()]
      .filter((r) => r.status === 'queued' || r.status === 'running' || r.status === 'waiting')
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
      .map(({ id, workflow, version, request, mode, status, inputs, cwd, state, definition }) => ({
        id,
        workflow,
        version,
        request,
        mode,
        status,
        inputs,
        cwd,
        state,
        definition,
      }));
  }

  /** Definizione propria della run, se ne ha una (run di creazione). */
  async definition(id: string): Promise<Workflow | null> {
    return this.runs.get(id)?.definition ?? null;
  }

  /** Valori della run (input e variabili) dall'ultimo stato salvato. */
  async values(id: string): Promise<Record<string, unknown>> {
    return this.runs.get(id)?.state?.values ?? {};
  }

  async setStatus(id: string, status: RunRowStatus, error: string | null = null): Promise<void> {
    this.change(id, (r) => ({ ...r, status, error, updatedAt: now() }));
  }

  async saveState(id: string, state: RunState): Promise<void> {
    this.change(id, (r) => ({ ...r, state, updatedAt: now() }));
  }

  /** Salva l'evento; null se quel numero del giornale del runner c'era già (reinvio). */
  async addEvent(id: string, runnerSeq: number, event: RunEvent): Promise<RunEventRecord | null> {
    if (!this.runs.has(id)) return null;
    const seqs = this.seqsOf(id);
    if (seqs.runner.has(runnerSeq)) return null;
    const record: RunEventRecord = { seq: seqs.last + 1, event, at: now() };
    appendLine(join(this.dir, id, EVENTS), JSON.stringify({ ...record, runnerSeq }));
    seqs.last = record.seq;
    seqs.runner.add(runnerSeq);
    return record;
  }

  /** Registra una richiesta; se esiste già (runner riconnesso) restituisce quella salvata. */
  async addPrompt(
    runId: string,
    promptId: string,
    prompt: Prompt,
  ): Promise<{ record: PromptRecord; created: boolean }> {
    const existing = await this.getPrompt(promptId);
    if (existing) return { record: existing, created: false };
    const record: PromptRecord = {
      id: promptId,
      runId,
      prompt,
      answer: null,
      status: 'pending',
      createdAt: now(),
    };
    this.change(runId, (r) => ({ ...r, prompts: [...r.prompts, record] }));
    return { record, created: true };
  }

  async getPrompt(promptId: string): Promise<PromptRecord | null> {
    for (const run of this.runs.values()) {
      const p = run.prompts.find((x) => x.id === promptId);
      if (p) return publicPrompt(p);
    }
    return null;
  }

  /** Salva la risposta solo se la richiesta è ancora in attesa. */
  async answerPrompt(promptId: string, answer: Answer): Promise<PromptRecord | null> {
    const current = await this.getPrompt(promptId);
    if (current?.status !== 'pending') return null;
    const record: PromptRecord = { ...current, answer, status: 'answered' };
    this.change(current.runId, (r) => ({
      ...r,
      prompts: r.prompts.map((p) => (p.id === promptId ? { ...record, answeredAt: now() } : p)),
    }));
    return record;
  }

  async pendingCount(runId: string): Promise<number> {
    return this.runs.get(runId)?.prompts.filter((p) => p.status === 'pending').length ?? 0;
  }

  /** Le richieste in attesa di una run ripartita da zero non hanno più senso. */
  async supersedePending(runId: string): Promise<void> {
    const run = this.runs.get(runId);
    if (!run?.prompts.some((p) => p.status === 'pending')) return;
    this.change(runId, (r) => ({
      ...r,
      prompts: r.prompts.map((p) =>
        p.status === 'pending' ? { ...p, status: 'superseded' as const } : p,
      ),
    }));
  }

  private seqsOf(id: string) {
    let s = this.seqs.get(id);
    if (!s) {
      const lines = readLines<EventLine>(join(this.dir, id, EVENTS));
      s = {
        last: lines.reduce((m, l) => Math.max(m, l.seq), 0),
        runner: new Set(lines.map((l) => l.runnerSeq)),
      };
      this.seqs.set(id, s);
    }
    return s;
  }

  private change(id: string, fn: (r: RunFile) => RunFile): void {
    const run = this.runs.get(id);
    if (run) this.write(fn(run));
  }

  private write(run: RunFile): void {
    writeJson(join(this.dir, run.id, RUN), run);
    this.runs.set(run.id, run);
  }
}
