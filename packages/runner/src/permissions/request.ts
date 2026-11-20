import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import {
  APPROVAL_PATH,
  type ApprovalRequest,
  type ApprovalResponse,
  type ClaudeDecision,
} from './protocol.js';

class Unauthorized extends Error {}

function post(pipe: string, token: string, body: ApprovalRequest): Promise<ApprovalResponse> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = httpRequest(
      {
        socketPath: pipe,
        path: APPROVAL_PATH,
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
          if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as ApprovalResponse);
          } catch (e) {
            reject(e as Error);
          }
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
      const res = await post(opts.pipe, opts.token, body);
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
