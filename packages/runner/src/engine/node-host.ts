import { join, resolve } from 'node:path';
import { knowledgePrompt, type ContextExclusions, type RunEvent } from '@jeko/shared';
import { loadKnowledge } from '../knowledge.js';
import { readPrompt } from '../prompts.js';
import type { PermissionBridge } from '../permissions/bridge.js';
import type { ProcessRequest, ProcessResponse } from '../permissions/protocol.js';
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
  /** Esclusioni dal contesto di claude, dal progetto della run. */
  exclude?: ContextExclusions;
  /** Processi che restano attivi dopo il turno (strumento `start_process`), per questa run. */
  startProcess?: (req: { command: string; cwd: string }) => Promise<ProcessResponse>;
}

/** Host reale: comandi locali, file system e claude CLI. */
export function createNodeHost(opts: NodeHostOptions): Host {
  const claude = opts.claude ?? [process.env['JEKO_CLAUDE_BIN'] ?? 'claude'];
  // Cartelle la cui conoscenza (.jeko/) claude ha già ricevuto in questa run.
  const informed = new Set<string>();
  const withKnowledge = (instructions: string, dir: string | undefined) => {
    if (dir === undefined || informed.has(dir)) return instructions;
    const k = loadKnowledge(dir);
    if (!k) return instructions; // un progetto nuovo la crea più avanti
    informed.add(dir);
    return `${knowledgePrompt(k)}\n\n---\n\n${instructions}`;
  };
  return {
    ask: opts.ask,
    approve: opts.approve,
    review: opts.review,
    emit: opts.emit,
    functions: hostFunctions,
    exec: (argv, cwd) =>
      run(argv, { ...((cwd ?? opts.cwd) !== undefined && { cwd: cwd ?? opts.cwd }) }),
    projectPrompt: async (name, cwd) => readPrompt(cwd ?? opts.cwd ?? process.cwd(), name),
    projectCommands: async (cwd) => {
      const k = loadKnowledge(cwd ?? opts.cwd ?? process.cwd());
      if (k?.commandsError) throw new Error(k.commandsError);
      return k?.commands ?? {};
    },
    agent: (req) => {
      const permissions = opts.permissions;
      const cwd = req.cwd ?? opts.cwd;
      const start = opts.startProcess;
      const startProcess =
        start &&
        ((p: ProcessRequest) =>
          start({ command: p.command, cwd: resolve(cwd ?? process.cwd(), p.cwd ?? '.') }));
      return durableTurn({
        dir: join(opts.turnsDir, req.turnKey),
        command: claude,
        prompt: withKnowledge(req.instructions, cwd),
        cwd,
        sessionId: req.sessionId,
        fork: req.fork,
        allowedTools: req.tools,
        effort: req.effort,
        model: req.model,
        exclude: opts.exclude,
        signal: req.signal,
        onActivity: req.onActivity,
        ...(permissions && {
          permissions: (dir: string, token?: string) => permissions(req, dir, token, startProcess),
        }),
      });
    },
  };
}
