export interface TurnInput {
  prompt: string;
  cwd?: string | undefined;
  /** Sessione di claude: nuova (`--session-id`) o da riprendere (`--resume`). */
  sessionId: string;
  resume: boolean;
  /** Strumenti ammessi senza chiedere (es. "Read", "Bash(npm test:*)"). */
  allowedTools?: string[] | undefined;
  /** Percorso di un file di configurazione MCP da passare a claude. */
  mcpConfig?: string | undefined;
  /** Strumento MCP a cui claude chiede i permessi (es. "mcp__jeko__approve"). */
  permissionPromptTool?: string | undefined;
  /** File di impostazioni aggiuntive (`--settings`), per l'hook PreToolUse di Jeko. */
  settings?: string | undefined;
  /** Variabili d'ambiente in più per claude (e quindi per hook e server MCP). */
  env?: Record<string, string> | undefined;
}

export interface TurnOutput {
  ok: boolean;
  output: string;
  sessionId?: string;
}

/** Argomenti per un turno non interattivo; il prompt passa da stdin, l'uscita è stream-json. */
export function claudeArgs(input: Omit<TurnInput, 'prompt' | 'cwd' | 'env'>): string[] {
  const args = ['-p', '--output-format', 'stream-json', '--verbose'];
  args.push(input.resume ? '--resume' : '--session-id', input.sessionId);
  if (input.allowedTools?.length) args.push('--allowedTools', input.allowedTools.join(','));
  if (input.mcpConfig) args.push('--mcp-config', input.mcpConfig);
  if (input.permissionPromptTool) args.push('--permission-prompt-tool', input.permissionPromptTool);
  if (input.settings) args.push('--settings', input.settings);
  return args;
}

/** Messaggio `result` di un'uscita stream-json (anche parziale); null se il turno non è finito. */
export function parseStream(text: string): TurnOutput | null {
  let result: TurnOutput | null = null;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let msg: { type?: unknown; result?: unknown; is_error?: unknown; session_id?: unknown };
    try {
      msg = JSON.parse(line) as typeof msg;
    } catch {
      continue; // riga a metà: il turno sta ancora scrivendo
    }
    if (msg.type !== 'result') continue;
    result = {
      ok: msg.is_error !== true,
      output: typeof msg.result === 'string' ? msg.result : '',
      ...(typeof msg.session_id === 'string' && { sessionId: msg.session_id }),
    };
  }
  return result;
}
