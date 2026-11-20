import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import {
  ServerToRunnerSchema,
  type Check,
  validator,
  type Answer,
  type Prompt,
  type RunEvent,
  type RunnerToServer,
  type RunStart,
  type ServerToRunner,
} from '@jeko/shared';
import { runWorkflow, type Host } from './engine/engine.js';
import type { Assistant } from './assist.js';
import type { FolderPicker } from './folder-picker.js';
import { Journals } from './journal.js';

/** La parte dell'host che passa dal server: domande, approvazioni, revisioni ed eventi. */
export type RemoteIo = Pick<Host, 'ask' | 'approve' | 'review' | 'emit'>;
export type HostFactory = (io: RemoteIo, start: RunStart, ctx: { runDir: string }) => Host;

export interface ClientOptions {
  url: string;
  /** Token del runner, inviato come `Authorization: Bearer`. */
  token?: string;
  runnerId: string;
  version: string;
  makeHost: HostFactory;
  /** Cartella dei dati del runner: giornali delle run e turni di claude. */
  dataDir: string;
  reconnectMs?: number;
  /** Verifiche dell'ambiente, inviate dopo ogni collegamento e su richiesta del server. */
  diagnose?: () => Promise<Check[]>;
  /** Risposte di claude alle richieste di assistenza; senza, ricevono un errore. */
  assist?: Assistant | undefined;
  /** Dialogo di scelta cartella del PC; senza, le richieste ricevono un errore. */
  pickFolder?: FolderPicker | undefined;
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
 * Connessione del runner al server: solo in uscita, con riconnessione automatica.
 * Ogni evento passa dal giornale su disco prima dell'invio; a ogni connessione si reinvia ciò
 * che il server non ha confermato, anche dopo un riavvio del runner. Le richieste all'utente
 * ancora aperte vengono rimandate (il server le riconosce dall'id).
 */
export class RunnerClient {
  private ws: WebSocket | null = null;
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
    const ws = new WebSocket(this.opts.url, {
      ...(this.opts.token && { headers: { authorization: `Bearer ${this.opts.token}` } }),
    });
    this.ws = ws;

    ws.on('unexpected-response', (_req, res) => {
      if (res.statusCode === 401) {
        this.log.error(
          'il server rifiuta il token del runner: scarica un nuovo installer dalla web-app',
        );
      } else this.log.warn(`il server ha risposto ${res.statusCode}`);
      ws.terminate();
    });

    ws.on('open', () => {
      this.log.info(`runner collegato a ${this.opts.url}`);
      this.raw({
        type: 'hello',
        runnerId: this.opts.runnerId,
        version: this.opts.version,
        activeRuns: this.activeRuns,
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
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private raw(msg: RunnerToServer): void {
    this.ws?.send(JSON.stringify(msg));
  }

  /** Scrive l'evento nel giornale e lo invia se si è collegati (altrimenti alla riconnessione). */
  private emit(event: RunEvent): void {
    const { seq } = this.journals.append(event.runId, event);
    if (this.open) this.raw({ type: 'run.event', seq, event });
  }

  // ---------- messaggi dal server ----------

  private onMessage(data: WebSocket.RawData): void {
    let msg: unknown;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return this.log.warn('messaggio non JSON ignorato');
    }
    if (!isServerMessage(msg)) return this.log.warn('messaggio non valido ignorato');

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
        if (s) this.abort(s);
        return;
      }
      case 'checks.request':
        return this.sendChecks();
      case 'folder.pick':
        return void this.pickFolder(msg);
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
      },
      this.opts.makeHost(io, start, { runDir: this.journals.runDir(start.runId) }),
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
