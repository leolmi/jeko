import type { FastifyBaseLogger } from 'fastify';
import type { WebSocket } from 'ws';
import {
  FINAL_STATUSES,
  RunnerToServerSchema,
  validator,
  type AdminMessage,
  type Answer,
  type RunEvent,
  type RunnerToServer,
  type RunRowStatus,
  type ServerToRunner,
} from '@jeko/shared';
import type { WorkflowStore } from '../workflows/store.js';
import type { RunLaunch, RunStore } from './store.js';

const isRunnerMessage = validator(RunnerToServerSchema);

export type AnswerOutcome = 'ok' | 'not-found' | 'already-answered' | 'wrong-kind';

/**
 * Collega l'unico runner (connessione in uscita dal PC dell'utente) con le run nel DB
 * e con le pagine admin aperte. Il runner non apre porte: è sempre lui a collegarsi.
 */
export class RunnerHub {
  private runner: { socket: WebSocket; runnerId: string; activeRuns: string[] } | null = null;
  private readonly admins = new Set<WebSocket>();

  constructor(
    private readonly runs: RunStore,
    private readonly workflows: WorkflowStore,
    private readonly log: FastifyBaseLogger,
  ) {}

  get connected(): boolean {
    return this.runner !== null;
  }

  // ---------- connessioni ----------

  attachRunner(socket: WebSocket): void {
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
  }

  // ---------- azioni dall'API ----------

  /** Avvia una run appena creata, se c'è un runner; altrimenti resta in coda. */
  async start(runId: string): Promise<void> {
    if (!this.runner) return;
    const run = (await this.runs.launchable()).find((r) => r.id === runId);
    if (run) await this.launch(run);
  }

  async answer(runId: string, promptId: string, answer: Answer): Promise<AnswerOutcome> {
    const current = await this.runs.getPrompt(promptId);
    if (!current || current.runId !== runId) return 'not-found';
    if (current.prompt.kind !== answer.kind) return 'wrong-kind';
    const record = await this.runs.answerPrompt(promptId, answer);
    if (!record) return 'already-answered';

    this.broadcast({ type: 'run.prompt', runId, prompt: record });
    if ((await this.runs.pendingCount(runId)) === 0) await this.setStatus(runId, 'running');
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

  private async onRunnerMessage(socket: WebSocket, raw: unknown): Promise<void> {
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
    }
  }

  private async onHello(socket: WebSocket, msg: Extract<RunnerToServer, { type: 'hello' }>) {
    if (this.runner && this.runner.socket !== socket) this.runner.socket.close(4000, 'Sostituito');
    this.runner = { socket, runnerId: msg.runnerId, activeRuns: msg.activeRuns };
    this.log.info({ runnerId: msg.runnerId, version: msg.version }, 'runner collegato');
    this.broadcast({ type: 'runner', connected: true, runnerId: msg.runnerId });
  }

  /** Il runner ha reinviato il suo giornale: ora lo stato salvato è aggiornato. */
  private async onReady() {
    const active = this.runner?.activeRuns ?? [];
    // Run vive nel runner: continuano da sole. Le altre ripartono dallo stato salvato.
    for (const run of await this.runs.launchable()) {
      if (active.includes(run.id)) continue;
      if (run.status !== 'queued') await this.runs.supersedePending(run.id);
      await this.launch(run);
    }
  }

  private async onEvent(seq: number, event: RunEvent) {
    const run = await this.runs.get(event.runId);
    const record = run && (await this.runs.addEvent(run.id, seq, event));
    // Si conferma comunque (anche un doppione o una run sconosciuta): il runner può dimenticarlo.
    this.sendRunner({ type: 'run.ack', runId: event.runId, seq });
    if (!run || !record) return;
    this.broadcast({ type: 'run.event', runId: run.id, record });

    if (event.type === 'state') await this.runs.saveState(run.id, event.state);
    if (event.type === 'run.finished') {
      await this.runs.supersedePending(run.id);
      await this.setStatus(run.id, event.status, event.error ?? null);
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

  private async launch(run: RunLaunch): Promise<void> {
    const def = await this.workflows.definition(run.workflow, run.version);
    if (!def) {
      await this.setStatus(run.id, 'failed', `Workflow ${run.workflow}@${run.version} non trovato`);
      return;
    }
    const sent = this.sendRunner({
      type: 'run.start',
      runId: run.id,
      workflow: def.workflow,
      request: run.request,
      mode: run.mode,
      ...(run.inputs && { inputs: run.inputs }),
      ...(run.cwd && { cwd: run.cwd }),
      ...(run.state && { state: run.state }),
    });
    if (sent) await this.setStatus(run.id, 'running');
  }

  private async setStatus(runId: string, status: RunRowStatus, error: string | null = null) {
    await this.runs.setStatus(runId, status, error);
    this.broadcast({ type: 'run.status', runId, status, error });
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

  private broadcast(msg: AdminMessage): void {
    for (const s of this.admins) this.sendTo(s, msg);
  }
}
