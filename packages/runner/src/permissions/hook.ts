import type { Policy, RunMode } from '@jeko/shared';
import { classifyTool, gateLevel, gateStops } from '../engine/policy.js';
import { ASK_TOOL, ENV } from './protocol.js';

/** Ciò che l'hook di un turno sa del workflow: arriva nella variabile JEKO_POLICY. */
export interface HookPolicy {
  policies: Policy[];
  mode: RunMode;
}

export interface HookInput {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
}

/**
 * Decisione dell'hook PreToolUse: `ask` quando una policy del workflow ferma l'azione,
 * anche se le impostazioni dell'utente la consentirebbero già; così la richiesta passa
 * dal server MCP dei permessi. Le domande di claude (AskUserQuestion) passano sempre di lì,
 * per arrivare alla chat. Altrimenti nessuna decisione: vale il flusso normale.
 * Non attende mai l'utente (gli hook hanno un tempo massimo).
 */
export function hookDecision(input: HookInput, policy: HookPolicy): { reason: string } | null {
  const tool = input.tool_name ?? '';
  if (!tool) return null;
  if (tool === ASK_TOOL) return { reason: "domanda per l'utente" };
  const { actions, command } = classifyTool(tool, input.tool_input ?? {});
  const level = gateLevel(actions, policy.policies);
  if (!level || !gateStops(level, policy.mode)) return null;
  return { reason: `${actions.join(', ')}: ${command}` };
}

export function hookOutput(reason: string): string {
  return JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason: `Jeko: ${reason}`,
    },
  });
}

/** Corpo del processo hook: legge stdin e l'ambiente, scrive la decisione su stdout. */
export function runHook(stdin: string, env: NodeJS.ProcessEnv): string {
  try {
    const policy = JSON.parse(env[ENV.policy] ?? '') as HookPolicy;
    const decision = hookDecision(JSON.parse(stdin) as HookInput, policy);
    return decision ? hookOutput(decision.reason) : '';
  } catch (e) {
    // Nel dubbio si chiede: un errore dell'hook non deve aprire nulla.
    return hookOutput(`verifica non riuscita (${e instanceof Error ? e.message : String(e)})`);
  }
}
