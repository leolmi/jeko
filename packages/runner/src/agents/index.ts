import type { AgentInfo, AgentsSettings } from '@jeko/shared';
import { claudeCommand, claudeDriver } from './claude/index.js';
import { codexCommand, codexDriver } from './codex.js';
import { cursorCommand, cursorDriver } from './cursor.js';
import type { AgentDriver } from './driver.js';
import { geminiCommand, geminiDriver } from './gemini.js';

/** Un agente che il runner sa usare. */
interface AgentDef {
  id: string;
  label: string;
  /** Comando senza impostazioni (variabile d'ambiente o nome dell'eseguibile). */
  defaultCommand(env: NodeJS.ProcessEnv): string[];
  create(command: string[]): AgentDriver;
  /** Driver non ancora provato con la CLI vera: si sceglie, ma il menu lo segna "(beta)". */
  preview?: boolean;
}

/** Agenti conosciuti; il primo è il predefinito. */
const AGENTS: readonly AgentDef[] = [
  { id: 'claude', label: 'Claude Code', defaultCommand: claudeCommand, create: claudeDriver },
  {
    id: 'codex',
    label: 'Codex CLI',
    defaultCommand: codexCommand,
    create: codexDriver,
    preview: true,
  },
  {
    id: 'cursor',
    label: 'Cursor CLI',
    defaultCommand: cursorCommand,
    create: cursorDriver,
    preview: true,
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    defaultCommand: geminiCommand,
    create: geminiDriver,
    preview: true,
  },
];

/** Agenti disponibili, per le impostazioni dell'app. */
export const agentInfos = (env: NodeJS.ProcessEnv = process.env): AgentInfo[] =>
  AGENTS.map((a) => ({
    id: a.id,
    label: a.label,
    command: a.defaultCommand(env).join(' '),
    ...(a.preview && { preview: true }),
  }));

/**
 * Driver dell'agente fissato in una run, col comando delle impostazioni se impostato. Errore se
 * non è (più) disponibile: la sessione è sua, un altro agente non saprebbe riprenderla.
 */
export function runAgent(
  id: string,
  settings: AgentsSettings | undefined,
  env: NodeJS.ProcessEnv = process.env,
): AgentDriver {
  const def = AGENTS.find((a) => a.id === id);
  if (!def) throw new Error(`L'agente della run (${id}) non è disponibile su questo PC`);
  const custom = settings?.commands?.[id]?.trim();
  return def.create(custom ? [custom] : def.defaultCommand(env));
}

/**
 * Driver dell'agente scelto nelle impostazioni, col suo comando se impostato; un agente
 * sconosciuto o non disponibile ricade sul predefinito.
 */
export function resolveAgent(
  settings: AgentsSettings | undefined,
  env: NodeJS.ProcessEnv = process.env,
): AgentDriver {
  const def = AGENTS.find((a) => a.id === settings?.default) ?? AGENTS[0]!;
  const custom = settings?.commands?.[def.id]?.trim();
  return def.create(custom ? [custom] : def.defaultCommand(env));
}
