import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import {
  APPROVAL_PATH,
  PROCESS_PATH,
  type ApprovalRequest,
  type ApprovalResponse,
  type ClaudeDecision,
  type ProcessRequest,
  type ProcessResponse,
} from './protocol.js';

class Unauthorized extends Error {}

function post<T>(pipe: string, token: string, path: string, body: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = httpRequest(
      {
        socketPath: pipe,
        path,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(data),
          authorization: `Bearer ${token}`,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          if (res.statusCode === 401) return reject(new Unauthorized());
          let parsed: unknown;
          try {
            parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch (e) {
            return reject(e as Error);
          }
          if (res.statusCode !== 200) {
            const error = (parsed as { error?: unknown } | null)?.error;
            return reject(new Error(typeof error === 'string' ? error : `HTTP ${res.statusCode}`));
          }
          resolve(parsed as T);
        });
      },
    );
    req.on('error', reject);
    req.end(data);
  });
}

export interface RequestOptions {
  pipe: string;
  token: string;
  /** Per quanto si riprova se il runner non risponde, prima di rifiutare. */
  giveUpMs?: number;
  retryMs?: number;
}

/**
 * Chiede al runner una decisione e attende finché arriva. Se il runner resta irraggiungibile
 * (o non riconosce il turno) per `giveUpMs`, rifiuta: nel dubbio non si concede nulla.
 */
export async function requestDecision(
  opts: RequestOptions,
  toolName: string,
  input: Record<string, unknown>,
): Promise<ClaudeDecision> {
  const body: ApprovalRequest = { requestId: randomUUID(), toolName, input };
  // Abbastanza per un riavvio del runner: il turno lo ritrova con lo stesso token.
  const giveUpMs = opts.giveUpMs ?? 5 * 60_000;
  const retryMs = opts.retryMs ?? 1000;
  let failingSince: number | null = null;
  for (;;) {
    try {
      const res = await post<ApprovalResponse>(opts.pipe, opts.token, APPROVAL_PATH, body);
      failingSince = null;
      if (res.status === 'decided') return res.decision;
    } catch (e) {
      // 401: il runner si è riavviato e non ha ancora ripreso il turno; si riprova.
      failingSince ??= Date.now();
      if (Date.now() - failingSince >= giveUpMs) {
        const message =
          e instanceof Unauthorized
            ? 'Jeko non riconosce questo turno'
            : 'Runner di Jeko non raggiungibile';
        return { behavior: 'deny', message };
      }
      await new Promise((r) => setTimeout(r, retryMs));
    }
  }
}

/** Chiede al runner di avviare un processo staccato; un solo tentativo (non si avvia due volte). */
export function requestProcess(
  opts: RequestOptions,
  body: ProcessRequest,
): Promise<ProcessResponse> {
  return post<ProcessResponse>(opts.pipe, opts.token, PROCESS_PATH, body).catch((e: unknown) => {
    throw e instanceof Unauthorized ? new Error('Jeko non riconosce questo turno') : e;
  });
}
