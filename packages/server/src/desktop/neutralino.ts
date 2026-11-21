import { randomUUID } from 'node:crypto';

/** Dati per collegarsi a Neutralino come estensione (li passa sullo stdin dell'estensione). */
export interface NeutralinoInfo {
  nlPort: string;
  nlToken: string;
  nlConnectToken: string;
  nlExtensionId: string;
}

export function parseNeutralinoInfo(text: string | undefined): NeutralinoInfo | null {
  if (!text) return null;
  try {
    const o = JSON.parse(text) as Partial<NeutralinoInfo>;
    return o.nlPort && o.nlToken && o.nlExtensionId
      ? {
          nlPort: String(o.nlPort),
          nlToken: o.nlToken,
          nlConnectToken: o.nlConnectToken ?? '',
          nlExtensionId: o.nlExtensionId,
        }
      : null;
  } catch {
    return null;
  }
}

/** Legge dallo stdin il JSON che Neutralino scrive all'avvio dell'estensione (o null). */
export function readNeutralinoStdin(timeoutMs = 3000): Promise<NeutralinoInfo | null> {
  return new Promise((resolve) => {
    let text = '';
    const done = (info: NeutralinoInfo | null) => {
      clearTimeout(timer);
      process.stdin.off('data', onData);
      process.stdin.pause();
      resolve(info);
    };
    const onData = (chunk: Buffer) => {
      text += chunk.toString('utf8');
      const info = parseNeutralinoInfo(text.trim().split(/\r?\n/)[0]);
      if (info) done(info);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    process.stdin.on('data', onData);
    process.stdin.on('end', () => done(parseNeutralinoInfo(text.trim())));
  });
}

/**
 * Collegamento del servizio alla finestra Neutralino: serve a sapere quando la finestra si
 * chiude (la connessione cade) e a chiuderla (riavvio dopo un aggiornamento).
 */
export class NeutralinoLink {
  private ws: WebSocket | null = null;
  private closed = false;
  private readonly closeHandlers: (() => void)[] = [];

  constructor(
    private readonly info: NeutralinoInfo,
    private readonly log: { warn(msg: string): void },
  ) {}

  connect(): void {
    const { nlPort, nlExtensionId, nlConnectToken } = this.info;
    const url = `ws://127.0.0.1:${nlPort}?extensionId=${encodeURIComponent(nlExtensionId)}&connectToken=${encodeURIComponent(nlConnectToken)}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    let opened = false;
    ws.addEventListener('open', () => (opened = true));
    // Alla chiusura della finestra arriva anche un errore: conta solo se non ci si è mai collegati.
    ws.addEventListener('error', () => {
      if (!opened) this.log.warn('connessione a Neutralino non riuscita');
    });
    ws.addEventListener('close', () => {
      if (this.closed) return;
      this.closed = true;
      for (const h of this.closeHandlers) h();
    });
  }

  /** La finestra si è chiusa (o non c'è mai stata). */
  onClose(handler: () => void): void {
    if (this.closed) handler();
    else this.closeHandlers.push(handler);
  }

  /** Chiude l'app Neutralino (la finestra). */
  exit(): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        id: randomUUID(),
        method: 'app.exit',
        accessToken: this.info.nlToken,
        data: { code: 0 },
      }),
    );
  }
}
