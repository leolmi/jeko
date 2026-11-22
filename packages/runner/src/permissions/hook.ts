import type { Policy, RunMode } from '@jeko/shared';
import { classifyTool, gateLevel, gateStops } from '../engine/policy.js';
import { ASK_TOOL, ENV, START_PROCESS_TOOL } from './protocol.js';

/** Ciò che l'hook di un turno sa del workflow: arriva nella variabile JEKO_POLICY. */
export interface HookPolicy {
  policies: Policy[];
  mode: RunMode;
}

export interface HookInput {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
}

export interface HookDecision {
  decision: 'ask' | 'deny';
  reason: string;
}

/** Motivo del rifiuto di run_in_background: a fine turno claude si chiude con ciò che ha avviato. */
export const NO_BACKGROUND =
  'i comandi in background vengono chiusi a fine turno. Per un processo che deve ' +
  `restare attivo (server di sviluppo e simili) usa ${START_PROCESS_TOOL}; per il resto ` +
  'esegui il comando in primo piano e aspetta qui il risultato.';

/**
 * Decisione dell'hook PreToolUse:
 * - `deny` per i comandi in background (`run_in_background`), che morirebbero a fine turno;
 * - `ask` quando una policy del workflow ferma l'azione, anche se le impostazioni dell'utente
 *   la consentirebbero già; così la richiesta passa dal server MCP dei permessi. Le domande
 *   di claude (AskUserQuestion) passano sempre di lì, per arrivare alla chat.
 * Altrimenti nessuna decisione: vale il flusso normale.
 * Non attende mai l'utente (gli hook hanno un tempo massimo).
 */
export function hookDecision(input: HookInput, policy: HookPolicy): HookDecision | null {
  const tool = input.tool_name ?? '';
  if (!tool) return null;
  if (input.tool_input?.['run_in_background'] === true)
    return { decision: 'deny', reason: NO_BACKGROUND };
  if (tool === ASK_TOOL) return { decision: 'ask', reason: "domanda per l'utente" };
  const { actions, command } = classifyTool(tool, input.tool_input ?? {});
  const level = gateLevel(actions, policy.policies);
  if (!level || !gateStops(level, policy.mode)) return null;
  return { decision: 'ask', reason: `${actions.join(', ')}: ${command}` };
}

export function hookOutput({ decision, reason }: HookDecision): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: `Jeko: ${reason}`,
    },
  });
}

/** Corpo del processo hook: legge stdin e l'ambiente, scrive la decisione su stdout. */
export function runHook(stdin: string, env: NodeJS.ProcessEnv): string {
  try {
    const policy = JSON.parse(env[ENV.policy] ?? '') as HookPolicy;
    const decision = hookDecision(JSON.parse(stdin) as HookInput, policy);
    return decision ? hookOutput(decision) : '';
  } catch (e) {
    // Nel dubbio si chiede: un errore dell'hook non deve aprire nulla.
    const reason = `verifica non riuscita (${e instanceof Error ? e.message : String(e)})`;
    return hookOutput({ decision: 'ask', reason });
  }
}
