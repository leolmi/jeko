/**
 * Driver di Codex CLI (OpenAI): `codex exec --json`. ANTEPRIMA, non provato con la CLI vera:
 * argomenti ed eventi vengono dalla documentazione e vanno verificati con la versione installata.
 *
 * - Richiesta da stdin (`-` come prompt).
 * - Sessione scelta da Codex (`thread.started`), ripresa con `exec resume <id>`; niente copia.
 * - Nessun blocco per azione: lavora nel sandbox `workspace-write` (scrive solo nella cartella).
 *   Le policy di Jeko non lo fermano (vedi fase 3 di PIANO-AGENTI.md).
 */
import type { ToolCall } from '../engine/policy.js';
import {
  cliChecks,
  jsonLine,
  jsonLines,
  obj,
  str,
  textActivity,
  toolActivity,
  turnAssistant,
  usageOf,
  withPlainNote,
} from './common.js';
import type { Activity, AgentDriver, TurnOutput } from './driver.js';

/** Livelli di ragionamento di Codex (`model_reasoning_effort`); `max` di Jeko → `xhigh`. */
const EFFORTS = ['low', 'medium', 'high', 'xhigh'] as const;
const effortOf = (e: string) => (e === 'max' ? 'xhigh' : e);

export const codexCommand = (env: NodeJS.ProcessEnv = process.env) => [
  env['JEKO_CODEX_BIN'] ?? 'codex',
];

/** Risultato: l'ultimo messaggio dell'agente, alla fine del turno (`turn.completed`/`failed`). */
export function parseCodexStream(text: string): TurnOutput | null {
  let sessionId: string | undefined;
  let last = '';
  let error: string | undefined;
  let result: TurnOutput | null = null;
  for (const msg of jsonLines(text)) {
    const type = msg['type'];
    if (type === 'thread.started') sessionId = str(msg['thread_id']) ?? sessionId;
    const item = obj(msg['item']);
    if (type === 'item.completed' && item['type'] === 'agent_message')
      last = str(item['text']) ?? last;
    if (type === 'error') error = str(msg['message']) ?? error;
    if (type === 'turn.completed')
      result = {
        ok: true,
        output: last,
        usage: usageOf(obj(msg['usage']), {
          input: 'input_tokens',
          output: 'output_tokens',
          cacheRead: 'cached_input_tokens',
        }),
      };
    if (type === 'turn.failed')
      result = { ok: false, output: str(obj(msg['error'])['message']) ?? error ?? last };
  }
  return result && sessionId ? { ...result, sessionId } : result;
}

export function parseCodexActivity(line: string): Activity[] {
  const msg = jsonLine(line);
  if (!msg) return [];
  const item = obj(msg['item']);
  const kind = item['type'];
  if (msg['type'] === 'item.completed' && kind === 'agent_message') {
    const text = str(item['text']);
    return text ? [textActivity(text)] : [];
  }
  if (msg['type'] !== 'item.started') return [];
  if (kind === 'command_execution') return [toolActivity('shell', str(item['command']) ?? '')];
  if (kind === 'web_search') return [toolActivity('web_search', str(item['query']) ?? '')];
  if (kind === 'mcp_tool_call')
    return [toolActivity(`${str(item['server']) ?? 'mcp'}.${str(item['tool']) ?? ''}`, '')];
  if (kind === 'file_change') {
    const paths = (Array.isArray(item['changes']) ? item['changes'] : [])
      .map((c) => str(obj(c)['path']))
      .filter(Boolean);
    return [toolActivity('edit', paths.join(', '))];
  }
  return [];
}

export const codexSession = (text: string): string | null => {
  for (const msg of jsonLines(text))
    if (msg['type'] === 'thread.started') return str(msg['thread_id']) ?? null;
  return null;
};

export function codexToolCall(tool: string, input: unknown): ToolCall {
  const i = obj(input);
  if (tool === 'command_execution' || tool === 'shell')
    return { kind: 'shell', name: tool, target: str(i['command']) ?? '' };
  if (tool === 'web_search') return { kind: 'web', name: tool, target: str(i['query']) ?? '' };
  return { kind: 'other', name: tool, target: '' };
}

export function codexDriver(command: string[] = codexCommand()): AgentDriver {
  const driver: AgentDriver = {
    id: 'codex',
    label: 'Codex CLI',
    command,
    caps: {
      resume: true,
      fork: false,
      ownSessionId: false,
      efforts: EFFORTS,
      models: [],
      gate: 'none',
      questions: false,
      context: false,
      usage: true,
      cost: false,
    },
    turn: (t) => {
      const opts = ['--json', '--skip-git-repo-check', '--sandbox', 'workspace-write'];
      if (t.model) opts.push('--model', t.model);
      if (t.effort) opts.push('-c', `model_reasoning_effort="${effortOf(t.effort)}"`);
      // Senza copia della sessione, un task che ne continua un altro parte da capo.
      const resume = t.resume && !t.fork && t.sessionId !== undefined;
      return {
        args: resume ? ['exec', ...opts, 'resume', t.sessionId!, '-'] : ['exec', ...opts, '-'],
      };
    },
    parseStream: parseCodexStream,
    parseActivity: parseCodexActivity,
    sessionOf: codexSession,
    preparePrompt: withPlainNote,
    toolCall: codexToolCall,
    assist: turnAssistant(() => driver),
    checks: (env) =>
      cliChecks('codex', command, env, {
        env: ['OPENAI_API_KEY', 'CODEX_API_KEY'],
        files: ['.codex/auth.json'],
      }),
  };
  return driver;
}
