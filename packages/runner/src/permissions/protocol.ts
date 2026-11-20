/**
 * Contratto locale tra il server MCP dei permessi (processo figlio di claude) e il runner.
 * Viaggia in HTTP su una named pipe (socket Unix fuori da Windows): nessuna porta aperta.
 *
 * Attesa lunga a tappe: il runner risponde `pending` dopo qualche secondo e il server MCP
 * ripete la stessa richiesta (stesso `requestId`), così nessun timeout HTTP la interrompe.
 */
export interface ApprovalRequest {
  /** Generato dal server MCP per ogni chiamata e ripetuto nei tentativi. */
  requestId: string;
  toolName: string;
  input: Record<string, unknown>;
}

/** Risposta nel formato atteso da `--permission-prompt-tool`. */
export type ClaudeDecision =
  | { behavior: 'allow'; updatedInput: Record<string, unknown> }
  | { behavior: 'deny'; message: string };

export type ApprovalResponse =
  { status: 'pending' } | { status: 'decided'; decision: ClaudeDecision };

export const APPROVAL_PATH = '/approval';
export const MCP_SERVER_NAME = 'jeko';
export const MCP_TOOL_NAME = 'approve';
export const PERMISSION_PROMPT_TOOL = `mcp__${MCP_SERVER_NAME}__${MCP_TOOL_NAME}`;
/** Strumento con cui claude fa domande all'utente: passa sempre da Jeko. */
export const ASK_TOOL = 'AskUserQuestion';

/** Variabili d'ambiente con cui il runner configura server MCP e hook di un turno. */
export const ENV = {
  pipe: 'JEKO_APPROVAL_PIPE',
  token: 'JEKO_APPROVAL_TOKEN',
  policy: 'JEKO_POLICY',
} as const;
