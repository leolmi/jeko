import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProcessStarter } from '../processes.js';
import {
  APPROVAL_PATH,
  PROCESS_PATH,
  type ApprovalRequest,
  type ApprovalResponse,
  type ClaudeDecision,
  type ProcessRequest,
} from './protocol.js';

/**
 * Decide una richiesta di permesso di claude (di solito: policy del workflow e, se serve,
 * l'utente). `updatedInput` sostituisce l'input dello strumento (es. le risposte di AskUserQuestion).
 */
export type Authorizer = (
  toolName: string,
  input: Record<string, unknown>,
) => Promise<{ approved: boolean; note?: string; updatedInput?: Record<string, unknown> }>;

interface Pending {
  decision?: ClaudeDecision;
  done: Promise<ClaudeDecision>;
}

interface Turn {
  authorize: Authorizer;
  startProcess: ProcessStarter | undefined;
  requests: Map<string, Pending>;
}

const MAX_BODY = 1024 * 1024;

/** Percorso di una pipe locale nuova (named pipe su Windows, socket Unix altrove). */
export function pipePath(name = `jeko-${process.pid}-${randomBytes(4).toString('hex')}`): string {
  return process.platform === 'win32' ? `\\\\.\\pipe\\${name}` : join(tmpdir(), `${name}.sock`);
}

function sameToken(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

function isRequest(v: unknown): v is ApprovalRequest {
  const r = v as Partial<ApprovalRequest> | null;
  return (
    typeof r === 'object' &&
    r !== null &&
    typeof r.requestId === 'string' &&
    r.requestId.length > 0 &&
    typeof r.toolName === 'string' &&
    typeof r.input === 'object' &&
    r.input !== null
  );
}

function isProcessRequest(v: unknown): v is ProcessRequest {
  const r = v as Partial<ProcessRequest> | null;
  return (
    typeof r === 'object' &&
    r !== null &&
    typeof r.command === 'string' &&
    r.command.trim().length > 0 &&
    (r.cwd === undefined || typeof r.cwd === 'string')
  );
}

/**
 * Endpoint dei permessi del runner. Ogni turno di claude si registra e riceve un token:
 * le richieste con quel token vanno al suo `Authorizer`, una sola volta per `requestId`.
 */
export class ApprovalEndpoint {
  private server: Server | undefined;
  private readonly turns = new Map<string, Turn>();

  constructor(
    readonly path: string = pipePath(),
    private readonly pollMs = 20_000,
  ) {}

  async start(): Promise<void> {
    if (process.platform !== 'win32') rmSync(this.path, { force: true });
    const server = createServer((req, res) => {
      const reply = (status: number, body: unknown = {}) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      if (req.method !== 'POST' || (req.url !== APPROVAL_PATH && req.url !== PROCESS_PATH))
        return reply(404);
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > MAX_BODY) req.destroy();
        else chunks.push(c);
      });
      req.on('end', () => {
        let body: unknown;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          return reply(400);
        }
        const auth = req.headers.authorization ?? '';
        const turn = this.findTurn(auth.startsWith('Bearer ') ? auth.slice(7) : '');
        if (req.url === PROCESS_PATH) {
          if (!isProcessRequest(body)) return reply(400);
          if (!turn) return reply(401);
          if (!turn.startProcess) return reply(501, { error: 'Avvio di processi non disponibile' });
          return void turn.startProcess(body).then(
            (r) => reply(200, r),
            (e: unknown) => reply(500, { error: e instanceof Error ? e.message : String(e) }),
          );
        }
        if (!isRequest(body)) return reply(400);
        if (!turn) return reply(401);
        void this.respond(turn, body).then((r) => reply(200, r));
      });
    });
    server.requestTimeout = 0;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.path, () => resolve());
    });
    this.server = server;
  }

  /**
   * Registra un turno (con il suo token, se lo si riaggancia dopo un riavvio); `dispose` lo
   * toglie (le richieste successive ricevono 401). `startProcess` serve a `start_process`.
   */
  register(
    authorize: Authorizer,
    token: string = randomUUID() + randomBytes(16).toString('hex'),
    startProcess?: ProcessStarter,
  ): { token: string; dispose: () => void } {
    this.turns.set(token, { authorize, startProcess, requests: new Map() });
    return { token, dispose: () => this.turns.delete(token) };
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = undefined;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  private findTurn(token: string) {
    for (const [t, turn] of this.turns) if (sameToken(t, token)) return turn;
    return undefined;
  }

  private async respond(turn: Turn, req: ApprovalRequest): Promise<ApprovalResponse> {
    let pending = turn.requests.get(req.requestId);
    if (!pending) {
      const p: Pending = {
        done: turn
          .authorize(req.toolName, req.input)
          .then(({ approved, note, updatedInput }): ClaudeDecision =>
            approved
              ? { behavior: 'allow', updatedInput: updatedInput ?? req.input }
              : { behavior: 'deny', message: note ? `Rifiutato: ${note}` : 'Rifiutato da Jeko' },
          )
          .catch((e: unknown) => ({
            behavior: 'deny' as const,
            message: `Permesso non deciso: ${e instanceof Error ? e.message : String(e)}`,
          }))
          .then((d) => (p.decision = d)),
      };
      pending = p;
      turn.requests.set(req.requestId, p);
    }
    if (pending.decision) return { status: 'decided', decision: pending.decision };
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<null>((r) => (timer = setTimeout(() => r(null), this.pollMs)));
    const decision = await Promise.race([pending.done, timeout]);
    clearTimeout(timer);
    return decision ? { status: 'decided', decision } : { status: 'pending' };
  }
}
