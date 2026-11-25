import type { AgentUsage, Check, ContextExclusions, ContextInventory } from '@jeko/shared';
import type { ToolCall } from '../engine/policy.js';
import type { PermissionBridge } from '../permissions/bridge.js';
import type { ApprovalEndpoint } from '../permissions/endpoint.js';

/** Esito di un turno dell'agente. */
export interface TurnOutput {
  ok: boolean;
  output: string;
  sessionId?: string;
  usage?: AgentUsage;
  /** Modello usato nel turno, se l'agente lo dice. */
  model?: string;
}

/** Cosa sta facendo l'agente in un turno: testo scritto o strumento usato. */
export type Activity =
  { kind: 'text'; text: string } | { kind: 'tool'; tool: string; text: string };

/** Risposta testuale dell'agente a un prompt, senza strumenti né progetto. */
export type Assistant = (prompt: string) => Promise<string>;

/** Cosa l'agente carica all'avvio in una cartella. */
export type ContextProbe = (cwd: string) => Promise<ContextInventory>;

/** Collegamento di un turno ai permessi di Jeko: file e variabili da passare all'agente. */
export interface PermissionInput {
  /** File di configurazione MCP (server `jeko`). */
  mcpConfig?: string | undefined;
  /** Strumento MCP a cui l'agente chiede i permessi. */
  permissionPromptTool?: string | undefined;
  /** File di impostazioni aggiuntive (hook). */
  settings?: string | undefined;
  /** Variabili d'ambiente in più (anche per hook e server MCP). */
  env?: Record<string, string> | undefined;
}

/** Permessi di un turno: configurazione per l'agente e token da ritrovare dopo un riavvio. */
export interface TurnPermissions {
  input: PermissionInput;
  token: string;
  dispose: () => void;
}

/** Un avvio del turno: la richiesta arriva da stdin, l'uscita va su file. */
export interface TurnStart {
  /** Cartella del turno, per i file che servono all'agente. */
  dir: string;
  /** Richiesta del turno (arriva anche da stdin): per gli agenti che la vogliono negli argomenti. */
  prompt: string;
  /** Assente al primo avvio di un agente che sceglie da sé la sessione. */
  sessionId?: string | undefined;
  /** Riprende la sessione invece di aprirne una nuova. */
  resume: boolean;
  /** Con `resume`: riparte da una copia della sessione, che resta intatta. */
  fork?: boolean | undefined;
  /** Strumenti ammessi senza chiedere, nella sintassi dell'agente. */
  allowedTools?: string[] | undefined;
  effort?: string | undefined;
  model?: string | undefined;
  exclude?: ContextExclusions | undefined;
  permissions?: PermissionInput | undefined;
}

/** Cosa sa fare l'agente: Jeko adatta i turni e l'interfaccia di conseguenza. */
export interface AgentCaps {
  /** Riprende una sessione e ne fa una copia. */
  resume: boolean;
  fork: boolean;
  /** L'id della sessione lo sceglie Jeko (altrimenti lo dà l'agente nell'uscita). */
  ownSessionId: boolean;
  /** Livelli di ragionamento accettati; [] se non c'è. */
  efforts: readonly string[];
  /** Alias dei modelli da proporre. */
  models: readonly string[];
  /** Ferma la singola azione per chiedere il permesso a Jeko. */
  gate: 'per-tool' | 'none';
  /** Fa domande all'utente nella chat. */
  questions: boolean;
  /** Analisi ed esclusioni dal contesto (strumenti, MCP, plugin, skill). */
  context: boolean;
  /** Riporta token e costo. */
  usage: boolean;
  cost: boolean;
}

/** Tutto ciò che Jeko deve sapere di un agente (Claude Code, …). */
export interface AgentDriver {
  /** Id stabile (impostazioni, diagnostica). */
  id: string;
  /** Nome mostrato e nei messaggi. */
  label: string;
  /** Comando dell'agente (argv). */
  command: string[];
  caps: AgentCaps;
  /** Argomenti e variabili d'ambiente di un avvio del turno. */
  turn(start: TurnStart): { args: string[]; env?: Record<string, string> };
  /** Risultato dell'uscita (anche parziale); null se il turno non è finito. */
  parseStream(text: string): TurnOutput | null;
  /** Attività contenute in una riga completa dell'uscita. */
  parseActivity(line: string): Activity[];
  /** Sessione scelta dall'agente, letta da un'uscita anche parziale (se `ownSessionId` è false). */
  sessionOf?(text: string): string | null;
  /** Richiesta da mandare all'agente (es. con la nota sul turno, se non ha un prompt di sistema). */
  preparePrompt?(prompt: string): string;
  /** Chiamata a uno strumento dell'agente, ridotta a ciò che guardano le policy. */
  toolCall(tool: string, input: unknown): ToolCall;
  /** Collegamento ai permessi di Jeko; assente se l'agente non sa fermare le azioni. */
  permissions?(opts: { endpoint: ApprovalEndpoint; scriptsDir: string }): PermissionBridge;
  assist: Assistant;
  probe?: ContextProbe;
  /** Verifiche dell'agente (installato, accesso…), per la diagnostica. */
  checks(env: NodeJS.ProcessEnv): Promise<Check[]>;
}
