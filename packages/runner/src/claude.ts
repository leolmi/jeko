import type { AgentUsage, ContextExclusions, ContextInventory } from '@jeko/shared';

export interface TurnInput {
  prompt: string;
  cwd?: string | undefined;
  /** Sessione di claude: nuova (`--session-id`) o da riprendere (`--resume`). */
  sessionId: string;
  resume: boolean;
  /** Con `resume`: riparte da una copia della sessione (`--fork-session`), che resta intatta. */
  fork?: boolean | undefined;
  /** Strumenti ammessi senza chiedere (es. "Read", "Bash(npm test:*)"). */
  allowedTools?: string[] | undefined;
  /** Ragionamento (`--effort`) e modello (`--model`) del turno. */
  effort?: string | undefined;
  model?: string | undefined;
  /** Percorso di un file di configurazione MCP da passare a claude. */
  mcpConfig?: string | undefined;
  /** Strumento MCP a cui claude chiede i permessi (es. "mcp__jeko__approve"). */
  permissionPromptTool?: string | undefined;
  /** File di impostazioni aggiuntive (`--settings`), per l'hook PreToolUse di Jeko. */
  settings?: string | undefined;
  /** Variabili d'ambiente in più per claude (e quindi per hook e server MCP). */
  env?: Record<string, string> | undefined;
  /** Cosa togliere dal contesto (i plugin passano invece dalle impostazioni). */
  exclude?: ContextExclusions | undefined;
}

export interface TurnOutput {
  ok: boolean;
  output: string;
  sessionId?: string;
  usage?: AgentUsage;
  /** Modello del turno, dal messaggio `init`. */
  model?: string;
}

/**
 * Strumenti che rimandano il lavoro a dopo la fine del turno (risvegli, monitor, cron):
 * in un turno di Jeko non c'è un "dopo", e claude resterebbe vivo ad aspettarli.
 */
export const NON_INTERACTIVE_TOOLS = [
  'ScheduleWakeup',
  'Monitor',
  'CronCreate',
  'CronDelete',
  'CronList',
];

/** Avviso a claude: il turno finisce col messaggio finale e chiude ciò che è in background. */
export const TURN_NOTE =
  'Stai lavorando dentro Jeko, in modalità non interattiva. Il turno finisce con il tuo ' +
  'messaggio finale: dopo, il processo viene chiuso insieme a tutto ciò che hai avviato in ' +
  'background e non riceverai notifiche. Aspetta qui ciò che ti serve prima di rispondere. ' +
  "Se l'utente vuole lasciare attivi dei processi (server di sviluppo e simili), avviali con " +
  'lo strumento mcp__jeko__start_process: restano attivi dopo il turno e Jeko li chiude alla ' +
  'chiusura del task. Non usare run_in_background, Start-Process, nohup o simili. Controlla ' +
  'che partano (log, porta) prima di rispondere e nella risposta indica per ciascuno PID, ' +
  "porta se ce l'ha e file di log.";

/** Argomenti per un turno non interattivo; il prompt passa da stdin, l'uscita è stream-json. */
export function claudeArgs(input: Omit<TurnInput, 'prompt' | 'cwd' | 'env'>): string[] {
  const args = ['-p', '--output-format', 'stream-json', '--verbose'];
  args.push(input.resume ? '--resume' : '--session-id', input.sessionId);
  if (input.resume && input.fork) args.push('--fork-session');
  if (input.allowedTools?.length) args.push('--allowedTools', input.allowedTools.join(','));
  if (input.effort) args.push('--effort', input.effort);
  if (input.model) args.push('--model', input.model);
  if (input.mcpConfig) args.push('--mcp-config', input.mcpConfig);
  if (input.permissionPromptTool) args.push('--permission-prompt-tool', input.permissionPromptTool);
  if (input.settings) args.push('--settings', input.settings);
  args.push('--append-system-prompt', TURN_NOTE);
  const deny = [
    ...NON_INTERACTIVE_TOOLS,
    ...(input.exclude?.tools ?? []),
    ...(input.exclude?.mcpServers ?? []).map(mcpPrefix),
  ];
  if (deny.length) args.push('--disallowedTools', deny.join(','));
  if (input.exclude?.skills) args.push('--disable-slash-commands');
  return args;
}

/**
 * Prefisso degli strumenti di un server MCP: claude li chiama `mcp__<server>__<strumento>`,
 * col nome del server ridotto a lettere, cifre, `_` e `-` (es. "claude.ai Gmail" → claude_ai_Gmail).
 */
export const mcpPrefix = (server: string) => `mcp__${server.replace(/[^\w-]/g, '_')}`;

/** Impostazioni con i plugin esclusi aggiunte (claude ne legge un solo `--settings`). */
export function settingsWithPlugins(
  settings: Record<string, unknown>,
  plugins: readonly string[],
): Record<string, unknown> {
  const current = (settings['enabledPlugins'] ?? {}) as Record<string, boolean>;
  return {
    ...settings,
    enabledPlugins: { ...current, ...Object.fromEntries(plugins.map((p) => [p, false])) },
  };
}

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);

/**
 * Cosa claude ha caricato, dal messaggio `system/init` dello stream-json; null se la riga
 * non lo è. Restano fuori il server MCP di Jeko e i plugin integrati nell'app di Claude.
 */
export function parseInit(line: string, ownMcp: string): ContextInventory | null {
  let msg: Record<string, unknown>;
  try {
    msg = JSON.parse(line) as typeof msg;
  } catch {
    return null;
  }
  if (msg['type'] !== 'system' || msg['subtype'] !== 'init') return null;
  const objects = (v: unknown) =>
    (Array.isArray(v) ? v : []).filter(
      (x): x is Record<string, unknown> => !!x && typeof x === 'object',
    );
  return {
    tools: strings(msg['tools']).filter((t) => !t.startsWith('mcp__')),
    mcpServers: objects(msg['mcp_servers'])
      .filter((m) => typeof m['name'] === 'string' && m['name'] !== ownMcp)
      .map((m) => ({ name: String(m['name']), status: String(m['status'] ?? '') })),
    plugins: objects(msg['plugins'])
      .filter((p) => typeof p['source'] === 'string' && !String(p['source']).endsWith('@builtin'))
      .map((p) => ({ name: String(p['name'] ?? p['source']), source: String(p['source']) })),
    skills: strings(msg['skills']),
  };
}

/**
 * Risultato emesso da claude per le notifiche dei task in background (es. quelli rimasti orfani
 * di un turno precedente, alla ripresa della sessione): non è la fine del turno.
 */
const isNotificationResult = (msg: Record<string, unknown>) =>
  (msg['origin'] as { kind?: unknown } | undefined)?.kind === 'task-notification';

/** Messaggio `result` di un'uscita stream-json (anche parziale); null se il turno non è finito. */
export function parseStream(text: string): TurnOutput | null {
  let result: TurnOutput | null = null;
  let model: string | undefined;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line) as typeof msg;
    } catch {
      continue; // riga a metà: il turno sta ancora scrivendo
    }
    if (msg.type === 'system' && msg['subtype'] === 'init' && typeof msg['model'] === 'string')
      model = msg['model'];
    if (msg.type !== 'result' || isNotificationResult(msg)) continue;
    const usage = parseUsage(msg);
    result = {
      ok: msg['is_error'] !== true,
      output: typeof msg['result'] === 'string' ? msg['result'] : '',
      ...(typeof msg['session_id'] === 'string' && { sessionId: msg['session_id'] }),
      ...(usage && { usage }),
    };
  }
  return result && model ? { ...result, model } : result;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

/** Tempi, token e costo di un messaggio `result`; null se non ne riporta. */
export function parseUsage(msg: Record<string, unknown>): AgentUsage | null {
  const u = msg['usage'];
  if (typeof msg['duration_ms'] !== 'number' && (!u || typeof u !== 'object')) return null;
  const t = (u ?? {}) as Record<string, unknown>;
  const cost = msg['total_cost_usd'];
  return {
    durationMs: num(msg['duration_ms']),
    inputTokens: num(t['input_tokens']),
    outputTokens: num(t['output_tokens']),
    cacheReadTokens: num(t['cache_read_input_tokens']),
    cacheWriteTokens: num(t['cache_creation_input_tokens']),
    ...(typeof cost === 'number' && cost >= 0 && { costUsd: cost }),
    turns: 1,
  };
}

/** Cosa sta facendo claude in un turno: testo scritto o strumento usato. */
export type Activity =
  { kind: 'text'; text: string } | { kind: 'tool'; tool: string; text: string };

const MAX_TEXT = 2000;
const MAX_DETAIL = 200;

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** Riassunto di una riga dell'input di uno strumento (comando, file, schema…). */
export function toolDetail(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const o = input as Record<string, unknown>;
  const q = Array.isArray(o['questions']) ? (o['questions'][0] as { question?: unknown }) : null;
  if (typeof q?.question === 'string') return clip(q.question, MAX_DETAIL);
  for (const k of ['command', 'file_path', 'path', 'pattern', 'url', 'query', 'description']) {
    if (typeof o[k] === 'string' && o[k]) return clip(String(o[k]).split('\n')[0]!, MAX_DETAIL);
  }
  const first = Object.values(o).find((v) => typeof v === 'string' && v);
  return typeof first === 'string' ? clip(first.split('\n')[0]!, MAX_DETAIL) : '';
}

/** Attività contenute in una riga di stream-json (solo i messaggi `assistant`). */
export function parseActivity(line: string): Activity[] {
  let msg: { type?: unknown; message?: { content?: unknown } };
  try {
    msg = JSON.parse(line) as typeof msg;
  } catch {
    return [];
  }
  if (msg.type !== 'assistant' || !Array.isArray(msg.message?.content)) return [];
  const out: Activity[] = [];
  for (const block of msg.message.content as Record<string, unknown>[]) {
    if (block['type'] === 'text' && typeof block['text'] === 'string' && block['text'].trim()) {
      out.push({ kind: 'text', text: clip(block['text'].trim(), MAX_TEXT) });
    } else if (block['type'] === 'tool_use' && typeof block['name'] === 'string') {
      out.push({ kind: 'tool', tool: block['name'], text: toolDetail(block['input']) });
    }
  }
  return out;
}
