import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { buildRelay } from '../../../relay/src/relay.js';
import type { RemoteStore } from './store.js';

/** Porta del relay su questo PC: è quella da esporre (es. `tailscale funnel --bg 8787`). */
export const LOCAL_RELAY_PORT = 8787;

export interface LocalRelayOptions {
  store: RemoteStore;
  /** Dati del relay (`channels.json`). */
  dataDir: string;
  /** Pagina remota (`packages/relay/public`, nel bundle `server/relay`). */
  publicDir?: string | undefined;
  /** 0 nei test: una porta libera. */
  port?: number;
  log: { info: (m: string) => void; warn: (m: string) => void };
}

/**
 * Relay dentro a Jeko, solo su 127.0.0.1: da fuori ci arriva chi lo espone in HTTPS (Funnel,
 * proxy). Il segreto è quello generato da Jeko, così il canale resta suo.
 */
export class LocalRelay {
  private app: FastifyInstance | null = null;
  private _error: string | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly opts: LocalRelayOptions) {}

  /** Indirizzo a cui si collega Jeko: quello del PC, senza passare da fuori. */
  get url(): string {
    const port = this.app
      ? (this.app.server.address() as AddressInfo).port
      : (this.opts.port ?? LOCAL_RELAY_PORT);
    return `http://127.0.0.1:${port}`;
  }
  /** Perché non è partito (es. porta occupata); null se va o se non serve. */
  get error(): string | null {
    return this._error;
  }

  /** Acceso o spento secondo le opzioni salvate. */
  sync(): Promise<void> {
    this.queue = this.queue.then(() => this.apply());
    return this.queue;
  }

  stop(): Promise<void> {
    this.queue = this.queue.then(() => this.close());
    return this.queue;
  }

  private async apply(): Promise<void> {
    const { store } = this.opts;
    if (!store.enabled || !store.localRelay) {
      this._error = null;
      return this.close();
    }
    if (this.app) return;
    const app = await buildRelay({
      dataDir: this.opts.dataDir,
      secret: store.localSecret,
      ...(this.opts.publicDir && { publicDir: this.opts.publicDir }),
    });
    const port = this.opts.port ?? LOCAL_RELAY_PORT;
    try {
      await app.listen({ host: '127.0.0.1', port });
      this.app = app;
      this._error = null;
      this.opts.log.info(`relay su questo PC: ${this.url}`);
    } catch (e) {
      await app.close();
      this._error =
        (e as NodeJS.ErrnoException).code === 'EADDRINUSE' ? `porta ${port} già in uso` : String(e);
      this.opts.log.warn(`relay su questo PC: ${this._error}`);
    }
  }

  private async close(): Promise<void> {
    const app = this.app;
    this.app = null;
    if (app) await app.close();
  }
}
