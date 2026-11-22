import { randomUUID } from 'node:crypto';
import type { FastifyBaseLogger } from 'fastify';
import type { WebSocket } from 'ws';
import {
  FINAL_STATUSES,
  folderKey,
  noExclusions,
  RunnerToServerSchema,
  validator,
  type AdminMessage,
  type Answer,
  type Check,
  type ContextInventory,
  type ProjectPrompt,
  type RunEvent,
  type RunnerToServer,
  type RunRowStatus,
  type ServerToRunner,
} from '@jeko/shared';
import type { ProjectStore } from '../projects/store.js';
import type { ClaudeModelStore } from '../settings/claude-models.js';
import type { UserSettingsStore } from '../settings/store.js';
import type { WorkflowStore } from '../workflows/store.js';
import type { RunLaunch, RunStore } from './store.js';

const isRunnerMessage = validator(RunnerToServerSchema);

/** Capo del server della connessione con il runner (in memoria, stesso processo). */
export interface RunnerSocket {
  readonly OPEN: number;
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: 'message', listener: (data: unknown) => void): unknown;
  on(event: 'close', listener: () => void): unknown;
}

/** Quanto si aspetta che l'utente scelga una cartella nel dialogo. */
const PICK_TIMEOUT_MS = 10 * 60_000;
const TERMINAL_TIMEOUT_MS = 15_000;
/** Quanto si aspetta una risposta di claude a una richiesta di assistenza. */
const ASSIST_TIMEOUT_MS = 5 * 60_000;
/** Lettura del contesto: claude parte, carica plugin e server MCP e manda l'elenco. */
const CONTEXT_TIMEOUT_MS = 90_000;

export type AnswerOutcome = 'ok' | 'not-found' | 'already-answered' | 'wrong-kind';

/**
 * Collega il runner (nello stesso processo) con le run salvate e con le pagine admin aperte.
 */
export class RunnerHub {
  private runner: {
    socket: RunnerSocket;
    runnerId: string;
    version: string;
    activeRuns: string[];
  } | null = null;
  /** Ultime verifiche dell'ambiente ricevute dal runner collegato. */
  private checks: { list: Check[]; at: string } | null = null;
  private readonly admins = new Set<WebSocket>();
  private pumping: Promise<void> = Promise.resolve();
  /** Richieste al runner (dialogo della cartella, assistenza) in attesa della risposta. */
  private readonly requests = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();

  constructor(
    private readonly runs: RunStore,
    private readonly workflows: WorkflowStore,
    private readonly settings: UserSettingsStore,
    private readonly projects: ProjectStore,
    private readonly log: FastifyBaseLogger,
    private readonly models: ClaudeModelStore,
  ) {}

  get connected(): boolean {
    return this.runner !== null;
  }

  /** Pagine admin collegate (finestre dell'app aperte). */
  get adminCount(): number {
    return this.admins.size;
  }

  /** Runner collegato e sue verifiche, per il primo avvio. */
  get runnerInfo() {
    return {
      connected: this.runner !== null,
      ...(this.runner && { runnerId: this.runner.runnerId, version: this.runner.version }),
      checks: this.checks?.list ?? null,
      ...(this.checks && { checkedAt: this.checks.at }),
    };
  }

  /** Chiede al runner di rifare le verifiche; false se non è collegato. */
  requestChecks(): boolean {
    return this.sendRunner({ type: 'checks.request' });
  }

  /**
   * Apre sul PC del runner il dialogo di scelta di una cartella e ne attende la risposta:
   * il percorso, o null se l'utente annulla. Fallisce se il runner manca o si scollega.
   */
  pickFolder(opts: { start?: string; title?: string }, timeoutMs = PICK_TIMEOUT_MS) {
    return this.request(timeoutMs, (requestId) => ({
      type: 'folder.pick',
      requestId,
      ...(opts.start && { start: opts.start }),
      ...(opts.title && { title: opts.title }),
    }));
  }

  /** Apre sul PC del runner un terminale nella cartella. Fallisce se il runner manca. */
  async openTerminal(cwd: string, timeoutMs = TERMINAL_TIMEOUT_MS): Promise<void> {
    await this.request(timeoutMs, (requestId) => ({ type: 'terminal.open', requestId, cwd }));
  }

  /** Cosa claude carica all'avvio nella cartella: strumenti, server MCP, plugin e skill. */
  contextInventory(cwd: string, timeoutMs = CONTEXT_TIMEOUT_MS) {
    return this.request<ContextInventory>(timeoutMs, (requestId) => ({
      type: 'context.request',
      requestId,
      cwd,
    }));
  }

  /** Chiede a claude, tramite il runner, una risposta testuale a un prompt. */
  assist(prompt: string, timeoutMs = ASSIST_TIMEOUT_MS) {
    return this.request(timeoutMs, (requestId) => ({ type: 'assist.request', requestId, prompt }));
  }

  /** Prompt del progetto nella cartella: elenco, o salvataggio/eliminazione e poi l'elenco. */
  projectPrompts(
    cwd: string,
    op: Extract<ServerToRunner, { type: 'prompts.request' }>['op'],
    timeoutMs = TERMINAL_TIMEOUT_MS,
  ) {
    return this.request<ProjectPrompt[]>(timeoutMs, (requestId) => ({
      type: 'prompts.request',
      requestId,
      cwd,
      op,
    }));
  }

  /** Manda una richiesta al runner e ne attende la risposta (errori: offline, timeout…). */
  private request<T = string | null>(
    timeoutMs: number,
    build: (requestId: string) => ServerToRunner,
  ) {
    return new Promise<T>((resolve, reject) => {
      const requestId = randomUUID();
      const timer = setTimeout(() => this.settle(requestId, new Error('timeout')), timeoutMs);
      this.requests.set(requestId, { resolve: resolve as (v: unknown) => void, reject, timer });
      if (!this.sendRunner(build(requestId))) this.settle(requestId, new Error('offline'));
    });
  }

  private settle(requestId: string, result: unknown): void {
    const pending = this.requests.get(requestId);
    if (!pending) return;
    this.requests.delete(requestId);
    clearTimeout(pending.timer);
    if (result instanceof Error) pending.reject(result);
    else pending.resolve(result);
  }

  // ---------- connessioni ----------

  attachRunner(socket: RunnerSocket): void {
    // I messaggi di un socket si elaborano in ordine: gli eventi di una run dipendono dai precedenti.
    let queue = Promise.resolve();
    socket.on('message', (raw) => {
      queue = queue
        .then(() => this.onRunnerMessage(socket, raw))
        .catch((e: unknown) => {
          this.log.error({ err: e }, 'errore nel messaggio del runner');
        });
    });
    socket.on('close', () => {
      if (this.runner?.socket !== socket) return;
      this.runner = null;
      this.checks = null;
      for (const id of [...this.requests.keys()]) this.settle(id, new Error('offline'));
      this.broadcast({ type: 'runner', connected: false });
    });
  }

  attachAdmin(socket: WebSocket): void {
    this.admins.add(socket);
    socket.on('close', () => this.admins.delete(socket));
    this.sendTo(socket, {
      type: 'runner',
      connected: this.connected,
      ...(this.runner && { runnerId: this.runner.runnerId }),
    });
    this.sendTo(socket, { type: 'claude.models', models: this.models.get() });
  }

  // ---------- azioni dall'API ----------

  /** Avvia una run appena creata se c'è un runner e la sua cartella è libera; altrimenti resta in coda. */
  async start(): Promise<void> {
    await this.pump(false);
  }

  async answer(runId: string, promptId: string, answer: Answer): Promise<AnswerOutcome> {
    const current = await this.runs.getPrompt(promptId);
    if (!current || current.runId !== runId) return 'not-found';
    if (current.prompt.kind !== answer.kind) return 'wrong-kind';
    const record = await this.runs.answerPrompt(promptId, answer);
    if (!record) return 'already-answered';

    this.broadcast({ type: 'run.prompt', runId, prompt: record });
    if ((await this.runs.pendingCount(runId)) === 0) await this.setStatus(runId, 'running');
    else await this.sendPath(runId);
    // Se il runner non c'è, riceverà la risposta quando rimanda la richiesta.
    this.sendRunner({ type: 'run.answer', runId, promptId, answer });
    return 'ok';
  }

  async cancel(runId: string): Promise<boolean> {
    const run = await this.runs.get(runId);
    if (!run || FINAL_STATUSES.includes(run.status)) return false;
    if (run.status === 'queued' || !this.runner) {
      await this.runs.supersedePending(runId);
      await this.setStatus(runId, 'cancelled');
    } else {
      this.sendRunner({ type: 'run.cancel', runId });
    }
    return true;
  }

  // ---------- messaggi dal runner ----------

  private async onRunnerMessage(socket: RunnerSocket, raw: unknown): Promise<void> {
    let msg: unknown;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      socket.close(1003, 'JSON non valido');
      return;
    }
    if (!isRunnerMessage(msg)) {
      this.log.warn({ errors: isRunnerMessage.errors }, 'messaggio del runner non valido');
      socket.close(1008, 'Messaggio non valido');
      return;
    }
    if (msg.type !== 'hello' && this.runner?.socket !== socket) {
      socket.close(1008, 'Manca hello');
      return;
    }
    switch (msg.type) {
      case 'hello':
        return this.onHello(socket, msg);
      case 'ready':
        return this.onReady();
      case 'run.event':
        return this.onEvent(msg.seq, msg.event);
      case 'run.prompt':
        return this.onPrompt(msg);
      case 'checks':
        this.checks = { list: msg.checks, at: new Date().toISOString() };
        return;
      case 'folder.picked':
        return this.settle(msg.requestId, msg.error ? new Error(msg.error) : msg.path);
      case 'assist.result':
        return this.settle(msg.requestId, msg.error ? new Error(msg.error) : msg.text);
      case 'terminal.opened':
        return this.settle(msg.requestId, msg.error ? new Error(msg.error) : null);
      case 'prompts.result':
        return this.settle(msg.requestId, msg.error ? new Error(msg.error) : msg.prompts);
      case 'context.result':
        return this.settle(
          msg.requestId,
          msg.error || !msg.inventory ? new Error(msg.error ?? 'nessun elenco') : msg.inventory,
        );
    }
  }

  private async onHello(socket: RunnerSocket, msg: Extract<RunnerToServer, { type: 'hello' }>) {
    if (this.runner && this.runner.socket !== socket) this.runner.socket.close(4000, 'Sostituito');
    this.runner = {
      socket,
      runnerId: msg.runnerId,
      version: msg.version,
      activeRuns: msg.activeRuns,
    };
    this.checks = msg.checks ? { list: msg.checks, at: new Date().toISOString() } : null;
    this.log.info({ runnerId: msg.runnerId, version: msg.version }, 'runner collegato');
    this.broadcast({ type: 'runner', connected: true, runnerId: msg.runnerId });
  }

  /** Il runner ha reinviato il suo giornale: ora lo stato salvato è aggiornato. */
  private async onReady() {
    await this.pump(true);
  }

  private async onEvent(seq: number, event: RunEvent) {
    const run = await this.runs.get(event.runId);
    const record = run && (await this.runs.addEvent(run.id, seq, event));
    // Si conferma comunque (anche un doppione o una run sconosciuta): il runner può dimenticarlo.
    this.sendRunner({ type: 'run.ack', runId: event.runId, seq });
    if (!run || !record) return;
    this.broadcast({ type: 'run.event', runId: run.id, record });

    if (event.type === 'step.finished' && event.defaultModel) {
      if (this.models.record(run.cwd, event.defaultModel))
        this.broadcast({ type: 'claude.models', models: this.models.get() });
    }
    if (event.type === 'state') {
      await this.runs.saveState(run.id, event.state);
      await this.sendPath(run.id);
    }
    // Una run già conclusa non cambia esito (es. annullata quando era appena finita).
    if (event.type === 'run.finished' && !FINAL_STATUSES.includes(run.status)) {
      await this.runs.supersedePending(run.id);
      await this.setStatus(run.id, event.status, event.error ?? null);
      if (event.status === 'done') await this.addCreatedProject(run.id, run.workflow, run.version);
      // La cartella si è liberata: può partire la prossima in coda.
      await this.pump(false);
    }
  }

  private async onPrompt(msg: Extract<RunnerToServer, { type: 'run.prompt' }>) {
    const run = await this.runs.get(msg.runId);
    if (!run || FINAL_STATUSES.includes(run.status)) return;
    const { record, created } = await this.runs.addPrompt(run.id, msg.promptId, msg.prompt);
    if (!created && record.status === 'answered' && record.answer) {
      // Il runner si era scollegato prima di ricevere la risposta.
      this.sendRunner({
        type: 'run.answer',
        runId: run.id,
        promptId: record.id,
        answer: record.answer,
      });
      return;
    }
    if (created) this.broadcast({ type: 'run.prompt', runId: run.id, prompt: record });
    await this.setStatus(run.id, 'waiting');
  }

  // ---------- supporto ----------

  /**
   * Un workflow di creazione concluso aggiunge il progetto all'elenco. Per convenzione
   * il workflow ha l'input `name` e la variabile `dir` (la cartella creata).
   */
  private async addCreatedProject(runId: string, workflow: string, version: number) {
    const def =
      (await this.runs.definition(runId)) ??
      (await this.workflows.definition(workflow, version))?.workflow;
    if (def?.kind !== 'create') return;
    const { name, dir } = await this.runs.values(runId);
    if (typeof name !== 'string' || typeof dir !== 'string' || !name.trim() || !dir.trim()) return;
    // `dir` unisce la cartella dei progetti (es. `C:\dev`) e lo slug con `/`: un solo separatore.
    const path = dir.includes('\\') ? dir.replace(/\//g, '\\') : dir;
    const project = await this.projects.add({ name, path });
    if (project) this.broadcast({ type: 'project.added', project });
  }

  /**
   * Avvia le run in coda, una sola attiva per cartella: due run nella stessa cartella
   * toccherebbero gli stessi file. Con `resume` riavvia anche quelle già partite che il
   * runner non ha più (dopo un suo riavvio). Le chiamate si mettono in fila.
   */
  private pump(resume: boolean): Promise<void> {
    const next = this.pumping.then(() => this.launchNext(resume));
    this.pumping = next.catch((e: unknown) => this.log.error({ err: e }, 'errore nella coda'));
    return next;
  }

  private async launchNext(resume: boolean): Promise<void> {
    if (!this.runner) return;
    const alive = this.runner.activeRuns;
    const busy = new Set<string>();
    for (const run of await this.runs.launchable()) {
      const key = folderKey(run.cwd);
      if (run.status !== 'queued') {
        // Già partita: tiene occupata la cartella, che sia viva nel runner o da riprendere.
        if (key) busy.add(key);
        if (!resume || alive.includes(run.id)) continue;
        await this.runs.supersedePending(run.id);
        if ((await this.launch(run)) === 'offline') return;
        continue;
      }
      if (key && busy.has(key)) continue;
      const outcome = await this.launch(run);
      if (outcome === 'offline') return;
      if (outcome === 'sent' && key) busy.add(key);
    }
  }

  private async launch(run: RunLaunch): Promise<'sent' | 'failed' | 'offline'> {
    const def = run.definition
      ? { workflow: run.definition }
      : await this.workflows.definition(run.workflow, run.version);
    if (!def) {
      await this.setStatus(run.id, 'failed', `Workflow ${run.workflow}@${run.version} non trovato`);
      return 'failed';
    }
    const settings = await this.settings.get();
    const exclude = (await this.projects.byPath(run.cwd))?.exclude;
    const sent = this.sendRunner({
      type: 'run.start',
      runId: run.id,
      workflow: def.workflow,
      request: run.request,
      mode: run.mode,
      ...(run.inputs && { inputs: run.inputs }),
      ...(run.cwd && { cwd: run.cwd }),
      ...(run.state && { state: run.state }),
      settings,
      ...(exclude && !noExclusions(exclude) && { exclude }),
      ...(run.agent && { agent: run.agent }),
      ...(run.forkSession && { forkSession: run.forkSession }),
    });
    if (!sent) return 'offline';
    await this.setStatus(run.id, 'running');
    return 'sent';
  }

  private async setStatus(runId: string, status: RunRowStatus, error: string | null = null) {
    await this.runs.setStatus(runId, status, error);
    this.broadcast({ type: 'run.status', runId, status, error });
    await this.sendPath(runId);
  }

  private async sendPath(runId: string): Promise<void> {
    const run = await this.runs.get(runId);
    if (run) this.broadcast({ type: 'run.path', runId, path: run.path });
  }

  private sendRunner(msg: ServerToRunner): boolean {
    const socket = this.runner?.socket;
    if (!socket || socket.readyState !== socket.OPEN) return false;
    socket.send(JSON.stringify(msg));
    return true;
  }

  private sendTo(socket: WebSocket, msg: AdminMessage): void {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
  }

  /** Avvisa le pagine aperte che dei task conclusi sono stati eliminati. */
  runsRemoved(ids: string[]): void {
    if (ids.length) this.broadcast({ type: 'runs.removed', ids });
  }

  private broadcast(msg: AdminMessage): void {
    for (const s of this.admins) this.sendTo(s, msg);
  }
}
