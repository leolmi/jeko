/**
 * Driver di Gemini CLI: `gemini --output-format stream-json`. ANTEPRIMA, non provato con la CLI
 * vera: argomenti ed eventi vengono dalla documentazione e vanno verificati.
 *
 * - Richiesta da stdin (senza terminale Gemini lavora in modalità non interattiva).
 * - Sessione scelta da Gemini (`init.session_id`), ripresa con `--resume <id>`; niente copia.
 * - Il testo arriva a pezzi (`message` con `delta`): il risultato è la loro unione.
 * - Nessun blocco per azione: con l'approvazione predefinita alcuni strumenti possono essere
 *   negati in modalità non interattiva; la scelta va fatta con la fase 3 di PIANO-AGENTI.md.
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

export const geminiCommand = (env: NodeJS.ProcessEnv = process.env) => [
  env['JEKO_GEMINI_BIN'] ?? 'gemini',
];

/** Messaggio `result` finale; il testo è l'unione dei messaggi dell'assistente. */
export function parseGeminiStream(text: string): TurnOutput | null {
  let sessionId: string | undefined;
  let model: string | undefined;
  let output = '';
  let result: TurnOutput | null = null;
  for (const msg of jsonLines(text)) {
    const type = msg['type'];
    if (type === 'init') {
      sessionId = str(msg['session_id']) ?? sessionId;
      model = str(msg['model']) ?? model;
    }
    if (type === 'message' && msg['role'] === 'assistant') output += str(msg['content']) ?? '';
    if (type !== 'result') continue;
    const stats = obj(msg['stats']);
    const ms = stats['duration_ms'];
    const ok = msg['status'] !== 'error';
    result = {
      ok,
      output: ok ? output.trim() : (str(obj(msg['error'])['message']) ?? output.trim()),
      usage: usageOf(
        stats,
        { input: 'input_tokens', output: 'output_tokens', cacheRead: 'cached' },
        typeof ms === 'number' ? ms : 0,
      ),
    };
  }
  if (!result) return null;
  return { ...result, ...(sessionId && { sessionId }), ...(model && { model }) };
}

export function parseGeminiActivity(line: string): Activity[] {
  const msg = jsonLine(line);
  if (!msg) return [];
  // I pezzi di testo (`delta`) sarebbero troppi: si mostrano solo i messaggi interi.
  if (msg['type'] === 'message' && msg['role'] === 'assistant' && msg['delta'] !== true) {
    const text = str(msg['content']);
    return text?.trim() ? [textActivity(text)] : [];
  }
  if (msg['type'] === 'tool_use') {
    const p = obj(msg['parameters']);
    const detail =
      str(p['command']) ?? str(p['file_path']) ?? str(p['path']) ?? str(p['query']) ?? '';
    return [toolActivity(str(msg['tool_name']) ?? 'tool', detail)];
  }
  return [];
}

export const geminiSession = (text: string): string | null => {
  for (const msg of jsonLines(text))
    if (msg['type'] === 'init') return str(msg['session_id']) ?? null;
  return null;
};

export function geminiToolCall(tool: string, input: unknown): ToolCall {
  const i = obj(input);
  if (tool === 'run_shell_command')
    return { kind: 'shell', name: tool, target: str(i['command']) ?? '' };
  if (tool === 'web_fetch' || tool === 'google_web_search')
    return { kind: 'web', name: tool, target: str(i['prompt']) ?? str(i['query']) ?? '' };
  return { kind: 'other', name: tool, target: '' };
}

export function geminiDriver(command: string[] = geminiCommand()): AgentDriver {
  const driver: AgentDriver = {
    id: 'gemini',
    label: 'Gemini CLI',
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
      usage: true,
      cost: false,
    },
    turn: (t) => {
      const args = ['--output-format', 'stream-json'];
      if (t.model) args.push('--model', t.model);
      if (t.resume && !t.fork && t.sessionId !== undefined) args.push('--resume', t.sessionId);
      return { args };
    },
    parseStream: parseGeminiStream,
    parseActivity: parseGeminiActivity,
    sessionOf: geminiSession,
    preparePrompt: withPlainNote,
    toolCall: geminiToolCall,
    assist: turnAssistant(() => driver),
    checks: (env) =>
      cliChecks('gemini', command, env, {
        env: ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_USE_VERTEXAI'],
        files: ['.gemini/oauth_creds.json'],
      }),
  };
  return driver;
}
