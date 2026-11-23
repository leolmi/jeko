import { createHash, type webcrypto } from 'node:crypto';
import {
  folderKey,
  type AdminMessage,
  type Project,
  type RemoteStatus,
  type RunSummary,
} from '@jeko/shared';
import { importKey, open, seal } from './seal.js';
import type { RemoteStore } from './store.js';

/** Richiesta HTTP fatta dentro al servizio (es. `app.inject`). */
export type Inject = (req: {
  method: string;
  url: string;
  payload?: unknown;
}) => Promise<{ status: number; body: string }>;

export interface RemoteLinkOptions {
  store: RemoteStore;
  inject: Inject;
  /** Iscrizione ai messaggi che il servizio manda alle pagine admin. */
  subscribe: (fn: (msg: AdminMessage) => void) => void;
  /** Avvisa le pagine admin: dispositivi o stato del collegamento cambiati. */
  changed: () => void;
  log: { info: (m: string) => void; warn: (m: string) => void };
  /** Solo per i test. */
  WebSocketImpl?: typeof WebSocket;
}

/** Cosa può fare un dispositivo remoto: leggere progetti e task, avviarli, rispondere, annullare. */
const ALLOWED: [string, RegExp][] = [
  ['GET', /^\/api\/projects$/],
  ['GET', /^\/api\/runs$/],
  ['GET', /^\/api\/runs\/[\w-]+$/],
  ['POST', /^\/api\/runs$/],
  ['POST', /^\/api\/runs\/[\w-]+\/prompts\/[\w-]+$/],
  ['POST', /^\/api\/runs\/[\w-]+\/cancel$/],
];
/** Messaggi admin girati ai dispositivi; quelli segnati cambiano anche lo stato salvato. */
const FORWARD: Partial<Record<AdminMessage['type'], boolean>> = {
  runner: false,
  'run.status': true,
  'run.prompt': true,
  'run.path': true,
  'run.event': false,
  'project.added': true,
  'runs.removed': true,
};
const MAX_SKEW_MS = 2 * 60_000;
const STATE_DEBOUNCE_MS = 1500;
/** Task conclusi nello stato salvato sul relay (quelli aperti ci sono tutti). */
const FINAL_IN_STATE = 30;
const EVENTS_IN_DETAIL = 150;

type DeviceBody =
  | { t: 'hello'; name?: string }
  | { t: 'req'; id: string; method: string; path: string; body?: unknown };

/**
 * Collegamento col relay: Jeko apre la connessione (niente porte aperte sul PC) e risponde ai
 * dispositivi confermati facendo le stesse richieste della web-app, ma solo quelle ammesse.
 */
export class RemoteLink {
  private socket: WebSocket | null = null;
  private retry: NodeJS.Timeout | null = null;
  private backoff = 1000;
  private stateTimer: NodeJS.Timeout | null = null;
  private readonly keys = new Map<string, webcrypto.CryptoKey>();
  /** Dispositivi con la pagina aperta adesso. */
  private readonly online = new Set<string>();
  /** Messaggi già visti (contro chi li rimanda): hash → ts. */
  private readonly seen = new Map<string, number>();
  private _status: RemoteStatus = 'off';

  constructor(private readonly opts: RemoteLinkOptions) {
    opts.subscribe((msg) => this.onAdmin(msg));
  }

  get status(): RemoteStatus {
    return this._status;
  }
  get onlineDevices(): string[] {
    return [...this.online];
  }
  /** Ci sono dispositivi confermati: il servizio resta acceso anche a finestra chiusa. */
  get keepsAlive(): boolean {
    return this.opts.store.enabled && this.opts.store.devices().some((d) => d.confirmed);
  }

  /** (Ri)collega secondo la configurazione salvata. */
  start(): void {
    this.stop();
    if (!this.opts.store.enabled) return;
    this.connect();
  }

  stop(): void {
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    const s = this.socket;
    this.socket = null;
    s?.close();
    this.online.clear();
    this.setStatus('off');
  }

  /** Dispositivo revocato: il relay chiude le sue pagine e dimentica il suo stato. */
  drop(deviceId: string): void {
    this.keys.delete(deviceId);
    this.online.delete(deviceId);
    this.sendRaw({ relay: 'drop', d: deviceId });
  }

  /** Dispositivo appena confermato: riceve subito lo stato. */
  async confirmed(deviceId: string): Promise<void> {
    await this.pushState([deviceId]);
  }

  private connect(): void {
    const Impl = this.opts.WebSocketImpl ?? WebSocket;
    const base = this.opts.store.relayUrl.replace(/^http/, 'ws');
    let socket: WebSocket;
    try {
      socket = new Impl(`${base}/ws/host?c=${encodeURIComponent(this.opts.store.channel)}`);
    } catch (e) {
      this.opts.log.warn(`relay: indirizzo non valido (${String(e)})`);
      this.setStatus('offline');
      return;
    }
    this.socket = socket;
    this.setStatus('connecting');
    socket.onopen = () =>
      socket.send(
        JSON.stringify({
          relay: 'auth',
          token: this.opts.store.token,
          ...(this.opts.store.secret && { secret: this.opts.store.secret }),
        }),
      );
    socket.onmessage = (e) => void this.onFrame(String(e.data));
    socket.onclose = (e) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.online.clear();
      // Rifiutato: riprovare non serve finché non cambiano segreto o relay (start()).
      if (e.code === 4401) {
        this.opts.log.warn('relay: accesso rifiutato (segreto o token)');
        return this.setStatus('rejected');
      }
      this.setStatus('offline');
      this.retry = setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, 30_000);
    };
    socket.onerror = () => {};
  }

  private setStatus(s: RemoteStatus): void {
    if (s === this._status) return;
    this._status = s;
    this.opts.changed();
  }

  private sendRaw(msg: unknown): void {
    const s = this.socket;
    if (s && s.readyState === s.OPEN) s.send(JSON.stringify(msg));
  }

  private async key(deviceId: string): Promise<webcrypto.CryptoKey | null> {
    const device = this.opts.store.device(deviceId);
    if (!device) return null;
    let key = this.keys.get(deviceId);
    if (!key) this.keys.set(deviceId, (key = await importKey(device.key)));
    return key;
  }

  private async sendTo(deviceId: string, body: unknown, state = false): Promise<void> {
    const key = await this.key(deviceId);
    if (!key) return;
    this.sendRaw({
      d: deviceId,
      m: await seal(key, 'h2c', deviceId, body),
      ...(state && { s: true }),
    });
  }

  private async onFrame(data: string): Promise<void> {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }
    if (msg['relay'] === 'ok') {
      this.backoff = 1000;
      this.setStatus('online');
      const clients = Array.isArray(msg['clients']) ? (msg['clients'] as string[]) : [];
      for (const d of clients) this.online.add(d);
      // Stato nuovo per tutti: il relay potrebbe essere ripartito senza.
      await this.pushState();
      return;
    }
    if (msg['relay'] === 'client' && typeof msg['d'] === 'string') {
      if (msg['online'] === true) {
        this.online.add(msg['d']);
        await this.pushState([msg['d']]);
      } else this.online.delete(msg['d']);
      return;
    }
    const d = msg['d'];
    const m = msg['m'];
    if (typeof d !== 'string' || typeof m !== 'string') return;
    const key = await this.key(d);
    if (!key) return;
    const opened = await open<DeviceBody>(key, 'c2h', d, m);
    if (!opened || !this.fresh(m, opened.ts)) return;
    await this.onDevice(d, opened.body);
  }

  /** Scarta i messaggi vecchi o già visti. */
  private fresh(m: string, ts: number): boolean {
    const now = Date.now();
    if (Math.abs(now - ts) > MAX_SKEW_MS) return false;
    for (const [h, t] of this.seen) if (now - t > 2 * MAX_SKEW_MS) this.seen.delete(h);
    const h = createHash('sha256').update(m).digest('base64url');
    if (this.seen.has(h)) return false;
    this.seen.set(h, ts);
    return true;
  }

  private async onDevice(d: string, body: DeviceBody): Promise<void> {
    const device = this.opts.store.device(d);
    if (!device || !body || typeof body !== 'object') return;
    if (body.t === 'hello') {
      const name = typeof body.name === 'string' ? body.name.slice(0, 60) : device.name;
      this.opts.store.update(d, { name, seenAt: new Date().toISOString() });
      this.opts.changed();
      if (device.confirmed) await this.pushState([d]);
      else await this.sendTo(d, { t: 'state', confirmed: false });
      return;
    }
    if (body.t !== 'req' || typeof body.id !== 'string') return;
    const reply = (status: number, res: unknown) =>
      this.sendTo(d, { t: 'res', id: body.id, status, body: res });
    if (!device.confirmed) return reply(403, { message: 'Dispositivo da confermare sul PC' });
    const method = String(body.method).toUpperCase();
    const path = String(body.path);
    if (!ALLOWED.some(([mm, re]) => mm === method && re.test(path)))
      return reply(403, { message: 'Richiesta non ammessa da remoto' });
    // Da remoto i task si avviano solo nella cartella di un progetto.
    if (method === 'POST' && path === '/api/runs') {
      const cwd = (body.body as { cwd?: unknown } | undefined)?.cwd;
      const projects = await this.get<Project[]>('/api/projects');
      if (typeof cwd !== 'string' || !projects?.some((p) => folderKey(p.path) === folderKey(cwd)))
        return reply(400, { message: 'Cartella non di un progetto' });
    }
    const res = await this.opts.inject({
      method,
      url: path,
      ...(body.body !== undefined && { payload: body.body }),
    });
    let parsed: unknown = null;
    try {
      parsed = res.body ? JSON.parse(res.body) : null;
    } catch {
      parsed = res.body;
    }
    if (method === 'GET' && /^\/api\/runs\/[\w-]+$/.test(path)) parsed = trimDetail(parsed);
    await reply(res.status, parsed);
  }

  private async get<T>(url: string): Promise<T | null> {
    const res = await this.opts.inject({ method: 'GET', url });
    return res.status === 200 ? (JSON.parse(res.body) as T) : null;
  }

  private onAdmin(msg: AdminMessage): void {
    const updatesState = FORWARD[msg.type];
    if (updatesState === undefined || this._status !== 'online') return;
    for (const d of this.online) {
      if (this.opts.store.device(d)?.confirmed) void this.sendTo(d, { t: 'event', msg });
    }
    if (updatesState) this.scheduleState();
  }

  private scheduleState(): void {
    if (this.stateTimer) return;
    this.stateTimer = setTimeout(() => {
      this.stateTimer = null;
      void this.pushState();
    }, STATE_DEBOUNCE_MS);
    this.stateTimer.unref();
  }

  /** Stato (progetti e task) ai dispositivi confermati: il relay tiene l'ultimo. */
  private async pushState(only?: string[]): Promise<void> {
    if (this._status !== 'online') return;
    const devices = this.opts.store.devices().filter((dev) => !only || only.includes(dev.id));
    if (devices.length === 0) return;
    const [projects, runs] = await Promise.all([
      this.get<Project[]>('/api/projects'),
      this.get<RunSummary[]>('/api/runs'),
    ]);
    const state = {
      t: 'state',
      confirmed: true,
      at: new Date().toISOString(),
      projects: (projects ?? []).map(({ id, name, path, favorite }) => ({
        id,
        name,
        path,
        favorite,
      })),
      runs: stateRuns(runs ?? []),
    };
    for (const dev of devices) {
      if (dev.confirmed) await this.sendTo(dev.id, state, true);
      else if (this.online.has(dev.id)) await this.sendTo(dev.id, { t: 'state', confirmed: false });
    }
  }
}

function stateRuns(runs: RunSummary[]): RunSummary[] {
  const open = runs.filter((r) => ['queued', 'running', 'waiting'].includes(r.status));
  const final = runs
    .filter((r) => !open.includes(r))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, FINAL_IN_STATE);
  return [...open, ...final].map((r) => ({ ...r, request: r.request.slice(0, 400) }));
}

/** Dettaglio di un task alleggerito per il telefono: ultimi eventi, testi accorciati. */
function trimDetail(detail: unknown): unknown {
  if (!detail || typeof detail !== 'object') return detail;
  const d = detail as { events?: { event: Record<string, unknown> }[] };
  if (!Array.isArray(d.events)) return detail;
  const events = d.events
    .filter((e) => e.event['type'] !== 'state')
    .slice(-EVENTS_IN_DETAIL)
    .map((e) => {
      const ev = { ...e.event };
      for (const k of ['text', 'output'])
        if (typeof ev[k] === 'string' && (ev[k] as string).length > 4000)
          ev[k] = `${(ev[k] as string).slice(0, 4000)}…`;
      return { ...e, event: ev };
    });
  return { ...d, events };
}
