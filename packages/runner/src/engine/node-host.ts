import { join } from 'node:path';
import type { RunEvent } from '@jeko/shared';
import type { PermissionBridge } from '../permissions/bridge.js';
import { run } from '../spawn.js';
import { durableTurn } from '../turn.js';
import type { Host } from './engine.js';
import { hostFunctions } from './host-functions.js';

export interface NodeHostOptions {
  /** Cartella di lavoro predefinita (per WF2 la cartella del progetto). */
  cwd?: string;
  /** Dove stanno i turni di claude della run (nel suo giornale). */
  turnsDir: string;
  /** Comando di claude; di default `JEKO_CLAUDE_BIN` o `claude`. */
  claude?: string[];
  /** Interazione con l'utente: fornita da chi usa il runner (server via WebSocket). */
  ask: Host['ask'];
  approve: Host['approve'];
  review: Host['review'];
  emit: (e: RunEvent) => void;
  /** Collega ogni turno di claude ai permessi di Jeko (server MCP + hook). */
  permissions?: PermissionBridge;
}

/** Host reale: comandi locali, file system e claude CLI. */
export function createNodeHost(opts: NodeHostOptions): Host {
  const claude = opts.claude ?? [process.env['JEKO_CLAUDE_BIN'] ?? 'claude'];
  return {
    ask: opts.ask,
    approve: opts.approve,
    review: opts.review,
    emit: opts.emit,
    functions: hostFunctions,
    exec: (argv, cwd) =>
      run(argv, { ...((cwd ?? opts.cwd) !== undefined && { cwd: cwd ?? opts.cwd }) }),
    agent: (req) => {
      const permissions = opts.permissions;
      return durableTurn({
        dir: join(opts.turnsDir, req.turnKey),
        command: claude,
        prompt: req.instructions,
        cwd: req.cwd ?? opts.cwd,
        sessionId: req.sessionId,
        allowedTools: req.tools,
        signal: req.signal,
        ...(permissions && {
          permissions: (dir: string, token?: string) => permissions(req, dir, token),
        }),
      });
    },
  };
}
