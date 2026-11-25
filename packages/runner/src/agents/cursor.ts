/**
 * Driver di Cursor CLI: `cursor-agent -p --output-format stream-json`. ANTEPRIMA, non provato
 * con la CLI vera: argomenti ed eventi vengono dalla documentazione e vanno verificati.
 *
 * - Richiesta negli argomenti (il modo documentato). Su Windows una riga di comando ha un limite
 *   di lunghezza: con richieste molto lunghe (conoscenza del progetto) va verificato.
 * - Sessione scelta da Cursor (`session_id`), ripresa con `--resume <id>`; niente copia.
 * - Nessun blocco per azione: senza `--force` i comandi di shell possono essere rifiutati; la
 *   scelta va fatta con la fase 3 di PIANO-AGENTI.md.
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
  withPlainNote,
} from './common.js';
import type { Activity, AgentDriver, TurnOutput } from './driver.js';

export const cursorCommand = (env: NodeJS.ProcessEnv = process.env) => [
  env['JEKO_CURSOR_BIN'] ?? 'cursor-agent',
];

/** Messaggio `result` (come Claude Code), col modello dell'`init`. */
export function parseCursorStream(text: string): TurnOutput | null {
  let model: string | undefined;
  let result: TurnOutput | null = null;
  for (const msg of jsonLines(text)) {
    if (msg['type'] === 'system' && msg['subtype'] === 'init') model = str(msg['model']) ?? model;
    if (msg['type'] !== 'result') continue;
    const sessionId = str(msg['session_id']);
    const ms = msg['duration_ms'];
    result = {
      ok: msg['is_error'] !== true && msg['subtype'] !== 'error',
      output: str(msg['result']) ?? '',
      ...(sessionId && { sessionId }),
      ...(typeof ms === 'number' && {
        usage: {
          durationMs: ms,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          turns: 1,
        },
      }),
    };
  }
  return result && model ? { ...result, model } : result;
}

/** `tool_call` → nome e input: `{ shellToolCall: { args: {...} } }` → `shell`, args. */
function toolOf(msg: Record<string, unknown>): { tool: string; args: Record<string, unknown> } {
  const call = obj(msg['tool_call']);
  const key = Object.keys(call)[0] ?? 'tool';
  return { tool: key.replace(/ToolCall$/, ''), args: obj(obj(call[key])['args']) };
}

export function parseCursorActivity(line: string): Activity[] {
  const msg = jsonLine(line);
  if (!msg) return [];
  if (msg['type'] === 'assistant') {
    const content = obj(msg['message'])['content'];
    return (Array.isArray(content) ? content : [])
      .map((b) => str(obj(b)['text']))
      .filter((t): t is string => !!t?.trim())
      .map(textActivity);
  }
  if (msg['type'] === 'tool_call' && msg['subtype'] === 'started') {
    const { tool, args } = toolOf(msg);
    const detail =
      str(args['command']) ?? str(args['path']) ?? str(args['pattern']) ?? str(args['url']) ?? '';
    return [toolActivity(tool, detail)];
  }
  return [];
}

export const cursorSession = (text: string): string | null => {
  for (const msg of jsonLines(text)) {
    const id = str(msg['session_id']);
    if (id) return id;
  }
  return null;
};

export function cursorToolCall(tool: string, input: unknown): ToolCall {
  const i = obj(input);
  if (tool === 'shell') return { kind: 'shell', name: tool, target: str(i['command']) ?? '' };
  if (tool === 'webSearch' || tool === 'webFetch')
    return { kind: 'web', name: tool, target: str(i['url']) ?? str(i['query']) ?? '' };
  return { kind: 'other', name: tool, target: '' };
}

export function cursorDriver(command: string[] = cursorCommand()): AgentDriver {
  const driver: AgentDriver = {
    id: 'cursor',
    label: 'Cursor CLI',
    command,
    caps: {
      resume: true,
      fork: false,
      ownSessionId: false,
      efforts: [],
      models: [],
      gate: 'none',
      questions: false,
      context: false,
      usage: false,
      cost: false,
    },
    turn: (t) => {
      const args = ['-p', '--output-format', 'stream-json'];
      if (t.model) args.push('--model', t.model);
      if (t.resume && !t.fork && t.sessionId !== undefined) args.push('--resume', t.sessionId);
      args.push(t.prompt);
      return { args };
    },
    parseStream: parseCursorStream,
    parseActivity: parseCursorActivity,
    sessionOf: cursorSession,
    preparePrompt: withPlainNote,
    toolCall: cursorToolCall,
    assist: turnAssistant(() => driver),
    checks: (env) =>
      cliChecks('cursor', command, env, {
        env: ['CURSOR_API_KEY'],
        files: ['.cursor/cli-config.json'],
      }),
  };
  return driver;
}
