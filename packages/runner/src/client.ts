import { randomUUID } from 'node:crypto';
import {
  ajv,
  ServerToRunnerSchema,
  type AgentInfo,
  type AgentsSettings,
  type Check,
  type ContextInventory,
  validator,
  type Answer,
  type Prompt,
  type ProjectPrompt,
  type RunEvent,
  type RunnerToServer,
  type RunStart,
  type ServerToRunner,
  type TaskProcess,
} from '@jeko/shared';
import { runWorkflow, type Host } from './engine/engine.js';
import type { Assistant, ContextProbe } from './agents/driver.js';
import type { FolderPicker } from './folder-picker.js';
import { deletePrompt, listPrompts, savePrompt } from './prompts.js';
import type { TerminalOpener } from './terminal.js';
import { Journals } from './journal.js';
import type { LinkSocket } from './link.js';

/** La parte dell'host che passa dal server: domande, approvazioni, revisioni ed eventi. */
export type RemoteIo = Pick<Host, 'ask' | 'approve' | 'review' | 'emit'>;
export type HostFactory = (io: RemoteIo, start: RunStart, ctx: { runDir: string }) => Host;

export interface ClientOptions {
  /** Apre una connessione verso il server (nello stesso processo: `linkPair`). */
  connect: () => LinkSocket;
  runnerId: string;
  version: string;
  makeHost: HostFactory;
  /** Cartella dei dati del runner: giornali delle run e turni di claude. */
  dataDir: string;
  reconnectMs?: number;
  /** Verifiche dell'ambiente, inviate dopo ogni collegamento e su richiesta del server. */
  diagnose?: () => Promise<Check[]>;
  /** Agenti disponibili, annunciati nel `hello`. */
  agents?: AgentInfo[] | undefined;
  /** Agente scelto nelle impostazioni; true se è cambiato (si rifanno le verifiche). */
  configureAgents?: ((agents: AgentsSettings) => boolean) | undefined;
  /** Risposte di claude alle richieste di assistenza; senza, ricevono un errore. */
  assist?: Assistant | undefined;
  /** Dialogo di scelta cartella del PC; senza, le richieste ricevono un errore. */
  pickFolder?: FolderPicker | undefined;
  /** Terminale del PC in una cartella; senza, le richieste ricevono un errore. */
  openTerminal?: TerminalOpener | undefined;
  /** Cosa claude carica all'avvio in una cartella; senza, le richieste ricevono un errore. */
  probeContext?: ContextProbe | undefined;
  /** Una run è finita (chiusa, annullata, fallita): es. chiude i processi lasciati attivi. */
  onRunFinished?: (runId: string) => void;
  /** Processi lasciati attivi da una run: elenco, o chiusura di quelli vivi (`stop`). */
  processes?: ((runId: string, stop: boolean) => TaskProcess[]) | undefined;
  log?: Pick<Console, 'info' | 'warn' | 'error'>;
}

interface Pending {
  message: Extract<RunnerToServer, { type: 'run.prompt' }>;
  resolve: (answer: Answer) => void;
  reject: (err: Error) => void;
}

interface Session {
  controller: AbortController;
  pending: Map<string, Pending>;
  done: Promise<unknown>;
}

const isServerMessage = validator(ServerToRunnerSchema);

/**
 * Connessione del runner al server, con riconnessione automatica.
 * Ogni evento passa dal giornale su disco prima dell'invio; a ogni connessione si reinvia ciò
 * che il server non ha confermato, anche dopo un riavvio del runner. Le richieste all'utente
 * ancora aperte vengono rimandate (il server le riconosce dall'id).
 */
export class RunnerClient {
  private ws: LinkSocket | null = null;
  private readonly journals: Journals;
  private readonly sessions = new Map<string, Session>();
  private stopped = false;
  private timer: NodeJS.Timeout | undefined;
  private readonly log: Pick<Console, 'info' | 'warn' | 'error'>;

  constructor(private readonly opts: ClientOptions) {
    this.log = opts.log ?? console;
    this.journals = new Journals(opts.dataDir);
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  /**
   * Chiude la connessione senza annullare nulla: i turni di claude continuano e il prossimo
   * runner li ritrova (uscita del processo, aggiornamento).
   */
  detach(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.ws?.close();
  }

  /** Chiude la connessione; le run in corso vengono annullate. */
  async stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    for (const s of this.sessions.values()) this.abort(s);
    await Promise.allSettled([...this.sessions.values()].map((s) => s.done));
    this.ws?.close();
  }

  get activeRuns(): string[] {
    return [...this.sessions.keys()];
  }

  /** Attende la fine di tutte le run in corso (utile nei test). */
  async idle(): Promise<void> {
    await Promise.allSettled([...this.sessions.values()].map((s) => s.done));
  }

  // ---------- connessione ----------

  private connect(): void {
    const ws = this.opts.connect();
    this.ws = ws;

    ws.on('open', () => {
      this.log.info('runner collegato al server');
      this.raw({
        type: 'hello',
        runnerId: this.opts.runnerId,
        version: this.opts.version,
        activeRuns: this.activeRuns,
        ...(this.opts.agents && { agents: this.opts.agents }),
      });
      // Prima ciò che il server non ha confermato, poi `ready`: solo allora riavvia le run.
      for (const runId of this.journals.runIds()) {
        const journal = this.journals.get(runId);
        for (const { seq, event } of journal.unacked()) this.raw({ type: 'run.event', seq, event });
        if (!this.sessions.has(runId)) this.journals.dropIfSettled(runId);
      }
      for (const s of this.sessions.values())
        for (const p of s.pending.values()) this.raw(p.message);
      this.raw({ type: 'ready' });
      this.sendChecks();
    });

    ws.on('message', (data) => this.onMessage(data));
    ws.on('error', (e) => this.log.warn(`errore di connessione: ${e.message}`));
    ws.on('close', () => {
      if (this.ws === ws) this.ws = null;
      if (!this.stopped)
        this.timer = setTimeout(() => this.connect(), this.opts.reconnectMs ?? 2000);
    });
  }

  private sendChecks(): void {
    const diagnose = this.opts.diagnose;
    if (!diagnose) return;
    diagnose().then(
      (checks) => {
        if (this.open) this.raw({ type: 'checks', checks });
      },
      (e: unknown) => this.log.warn('verifiche non riuscite', e),
    );
  }

  private get open(): boolean {
    return this.ws?.readyState === this.ws?.OPEN;
  }

  private raw(msg: RunnerToServer): void {
    this.ws?.send(JSON.stringify(msg));
  }

  /** Scrive l'evento nel giornale e lo invia se si è collegati (altrimenti alla riconnessione). */
  private emit(event: RunEvent): void {
    const { seq } = this.journals.append(event.runId, event);
    if (this.open) this.raw({ type: 'run.event', seq, event });
    if (event.type === 'run.finished') {
      try {
        this.opts.onRunFinished?.(event.runId);
      } catch (e) {
        this.log.warn('chiusura dei processi della run non riuscita', e);
      }
    }
  }

  // ---------- messaggi dal server ----------

  private onMessage(data: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return this.log.warn('messaggio non JSON ignorato');
    }
    if (!isServerMessage(msg)) {
      const reason = ajv.errorsText(isServerMessage.errors);
      this.log.warn(`messaggio non valido ignorato: ${reason}`);
      // Un avvio scartato lascerebbe la run "in corso" per sempre: meglio farla fallire.
      const m = msg as { type?: unknown; runId?: unknown };
      if (m?.type === 'run.start' && typeof m.runId === 'string' && !this.sessions.has(m.runId))
        this.emit({
          type: 'run.finished',
          runId: m.runId,
          status: 'failed',
          error: `Avvio non valido per il runner: ${reason}`,
        });
      return;
    }

    switch (msg.type) {
      case 'run.start':
        return this.startRun(msg);
      case 'run.answer': {
        const p = this.sessions.get(msg.runId)?.pending.get(msg.promptId);
        if (!p) return;
        if (p.message.prompt.kind !== msg.answer.kind)
          return this.log.warn('risposta di tipo errato');
        this.sessions.get(msg.runId)!.pending.delete(msg.promptId);
        return p.resolve(msg.answer);
      }
      case 'run.cancel': {
        const s = this.sessions.get(msg.runId);
        if (s) return this.abort(s);
        // Run che il runner non sta eseguendo (es. avvio scartato): resterebbe "in corso".
        return this.emit({
          type: 'run.finished',
          runId: msg.runId,
          status: 'cancelled',
          error: 'Run annullata',
        });
      }
      case 'checks.request':
        return this.sendChecks();
      case 'agents.config':
        if (this.opts.configureAgents?.(msg.agents)) this.sendChecks();
        return;
      case 'folder.pick':
        return void this.pickFolder(msg);
      case 'terminal.open':
        return void this.openTerminal(msg);
      case 'processes.request':
        return this.taskProcesses(msg);
      case 'context.request':
        return void this.probeContext(msg);
      case 'prompts.request':
        return this.projectPrompts(msg);
      case 'assist.request':
        return void this.assist(msg);
      case 'run.ack': {
        this.journals.get(msg.runId).ack(msg.seq);
        if (!this.sessions.has(msg.runId)) this.journals.dropIfSettled(msg.runId);
        return;
      }
    }
  }

  // ---------- assistenza ----------

  private async assist(msg: Extract<ServerToRunner, { type: 'assist.request' }>): Promise<void> {
    const reply = (text: string | null, error?: string) =>
      this.raw({ type: 'assist.result', requestId: msg.requestId, text, ...(error && { error }) });
    if (!this.opts.assist) return reply(null, 'Assistenza non disponibile');
    try {
      reply(await this.opts.assist(msg.prompt));
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      this.log.warn(`assistenza: ${reason}`);
      reply(null, reason);
    }
  }

  // ---------- scelta cartella ----------

  private picking = false;

  /** Un dialogo alla volta: un secondo, mentre il primo è aperto, riceve un errore. */
  private async pickFolder(msg: Extract<ServerToRunner, { type: 'folder.pick' }>): Promise<void> {
    const reply = (path: string | null, error?: string) =>
      this.raw({ type: 'folder.picked', requestId: msg.requestId, path, ...(error && { error }) });
    const pick = this.opts.pickFolder;
    if (!pick) return reply(null, 'Dialogo non disponibile su questo sistema');
    if (this.picking) return reply(null, 'C’è già un dialogo aperto');
    this.picking = true;
    try {
      reply(
        await pick({
          ...(msg.start && { start: msg.start }),
          ...(msg.title && { title: msg.title }),
        }),
      );
    } catch (e) {
      this.log.warn(`dialogo della cartella: ${e instanceof Error ? e.message : String(e)}`);
      reply(null, 'Dialogo non riuscito');
    } finally {
      this.picking = false;
    }
  }

  // ---------- prompt del progetto ----------

  /** Opera sui prompt in `.jeko/prompts/` e risponde con l'elenco aggiornato. */
  private projectPrompts(msg: Extract<ServerToRunner, { type: 'prompts.request' }>): void {
    const reply = (prompts: ProjectPrompt[], error?: string) =>
      this.raw({
        type: 'prompts.result',
        requestId: msg.requestId,
        prompts,
        ...(error && { error }),
      });
    try {
      const { op, cwd } = msg;
      if (op.kind === 'save') savePrompt(cwd, op.name, op.text);
      if (op.kind === 'delete') deletePrompt(cwd, op.name);
      reply(listPrompts(cwd));
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      this.log.warn(`prompt del progetto: ${reason}`);
      reply([], reason);
    }
  }

  // ---------- contesto di claude ----------

  private async probeContext(msg: Extract<ServerToRunner, { type: 'context.request' }>) {
    const reply = (inventory: ContextInventory | null, error?: string) =>
      this.raw({
        type: 'context.result',
        requestId: msg.requestId,
        inventory,
        ...(error && { error }),
      });
    const probe = this.opts.probeContext;
    if (!probe) return reply(null, 'Lettura del contesto non disponibile');
    try {
      reply(await probe(msg.cwd));
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      this.log.warn(`contesto di claude: ${reason}`);
      reply(null, reason);
    }
  }

  // ---------- processi lasciati attivi ----------

  private taskProcesses(msg: Extract<ServerToRunner, { type: 'processes.request' }>): void {
    const reply = (processes: TaskProcess[], error?: string) =>
      this.raw({
        type: 'processes.result',
        requestId: msg.requestId,
        processes,
        ...(error && { error }),
      });
    const list = this.opts.processes;
    if (!list) return reply([], 'Processi non disponibili');
    try {
      reply(list(msg.runId, msg.stop));
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      this.log.warn(`processi del task: ${reason}`);
      reply([], reason);
    }
  }

  // ---------- terminale ----------

  private async openTerminal(msg: Extract<ServerToRunner, { type: 'terminal.open' }>) {
    const reply = (error?: string) =>
      this.raw({ type: 'terminal.opened', requestId: msg.requestId, ...(error && { error }) });
    const open = this.opts.openTerminal;
    if (!open) return reply('Terminale non disponibile su questo sistema');
    try {
      await open(msg.cwd);
      reply();
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      this.log.warn(`terminale: ${reason}`);
      reply(reason);
    }
  }

  // ---------- run ----------

  private startRun(start: RunStart): void {
    if (this.sessions.has(start.runId)) return;
    const session: Session = {
      controller: new AbortController(),
      pending: new Map(),
      done: Promise.resolve(),
    };

    const request = <K extends Prompt['kind']>(prompt: Extract<Prompt, { kind: K }>) =>
      new Promise<Extract<Answer, { kind: K }>>((resolve, reject) => {
        if (session.controller.signal.aborted) return reject(new Error('Run annullata'));
        const promptId = randomUUID();
        const message = { type: 'run.prompt' as const, runId: start.runId, promptId, prompt };
        session.pending.set(promptId, {
          message,
          resolve: resolve as (a: Answer) => void,
          reject,
        });
        if (this.open) this.raw(message);
      });

    const io: RemoteIo = {
      emit: (event) => this.emit(event),
      ask: async (req) => (await request({ kind: 'ask', ...req })).value,
      approve: async (req) => {
        const a = await request({ kind: 'approve', ...req });
        return { approved: a.approved, ...(a.note !== undefined && { note: a.note }) };
      },
      review: async (req) => {
        const a = await request({ kind: 'review', ...req });
        return a.ok ? { ok: true } : { ok: false, feedback: a.feedback ?? 'Rivedi il lavoro.' };
      },
    };

    let host: Host;
    try {
      host = this.opts.makeHost(io, start, { runDir: this.journals.runDir(start.runId) });
    } catch (e) {
      // Es. l'agente della run non c'è più: la run fallisce invece di restare in corso.
      const reason = e instanceof Error ? e.message : String(e);
      this.log.warn(`run ${start.runId}: ${reason}`);
      return this.emit({
        type: 'run.finished',
        runId: start.runId,
        status: 'failed',
        error: reason,
      });
    }
    this.sessions.set(start.runId, session);
    session.done = runWorkflow(
      {
        runId: start.runId,
        workflow: start.workflow,
        request: start.request,
        mode: start.mode,
        signal: session.controller.signal,
        ...(start.inputs && { inputs: start.inputs }),
        ...(start.state && { state: start.state }),
        ...(start.settings && { settings: start.settings }),
        ...(start.agent && { agent: start.agent }),
        ...(start.forkSession && { forkSession: start.forkSession }),
      },
      host,
    )
      .catch((e: unknown) => this.log.error('errore inatteso nella run', e))
      .finally(() => {
        this.sessions.delete(start.runId);
        this.journals.dropIfSettled(start.runId);
      });
  }

  private abort(session: Session): void {
    session.controller.abort();
    for (const p of session.pending.values()) p.reject(new Error('Run annullata'));
    session.pending.clear();
  }
}
