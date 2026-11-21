import { EventEmitter } from 'node:events';

/**
 * Lato di una connessione server ↔ runner: la parte dell'API di `ws` che usano i due capi.
 * Server e runner girano nello stesso processo, quindi niente rete: due capi in memoria.
 */
export interface LinkSocket {
  readonly OPEN: 1;
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  on(event: 'open', listener: () => void): this;
  on(event: 'message', listener: (data: string) => void): this;
  on(event: 'close', listener: () => void): this;
  on(event: 'error', listener: (e: Error) => void): this;
}

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 3;

class LocalSocket extends EventEmitter implements LinkSocket {
  readonly OPEN = OPEN;
  readyState = CONNECTING;
  peer!: LocalSocket;

  send(data: string): void {
    if (this.readyState !== OPEN) return;
    // Consegna asincrona e in ordine, come una connessione vera: niente rientri.
    const peer = this.peer;
    queueMicrotask(() => {
      if (peer.readyState === OPEN) peer.emit('message', data);
    });
  }

  close(): void {
    for (const s of [this, this.peer]) {
      if (s.readyState === CLOSED) continue;
      s.readyState = CLOSED;
      queueMicrotask(() => s.emit('close'));
    }
  }

  terminate(): void {
    this.close();
  }
}

/** Due capi collegati: quello che si dà al server e quello del runner. Si aprono subito dopo. */
export function linkPair(): [server: LinkSocket, runner: LinkSocket] {
  const a = new LocalSocket();
  const b = new LocalSocket();
  a.peer = b;
  b.peer = a;
  queueMicrotask(() => {
    for (const s of [a, b]) {
      if (s.readyState !== CONNECTING) continue;
      s.readyState = OPEN;
      s.emit('open');
    }
  });
  return [a, b];
}
