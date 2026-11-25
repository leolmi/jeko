import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentUsage, Check } from '@jeko/shared';
import { run } from '../spawn.js';
import type { AgentDriver, Assistant } from './driver.js';

const TIMEOUT = 15_000;

/**
 * Nota sul turno per gli agenti senza prompt di sistema aggiuntivo: va in testa alla richiesta.
 * Senza il server MCP di Jeko non c'è `start_process`: niente processi lasciati attivi.
 */
export const PLAIN_TURN_NOTE =
  'Stai lavorando dentro Jeko, in modalità non interattiva. Il turno finisce con il tuo ' +
  'messaggio finale: dopo, il processo viene chiuso insieme a tutto ciò che hai avviato in ' +
  'background. Aspetta qui ciò che ti serve prima di rispondere e non lasciare processi attivi.';

export const withPlainNote = (prompt: string) => `${PLAIN_TURN_NOTE}\n\n---\n\n${prompt}`;

/** Righe JSON di un'uscita JSONL; le righe a metà o non JSON si saltano. */
export function jsonLines(text: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const line of text.split('\n')) {
    const msg = jsonLine(line);
    if (msg) out.push(msg);
  }
  return out;
}

export function jsonLine(line: string): Record<string, unknown> | null {
  if (!line.trim()) return null;
  try {
    const v = JSON.parse(line) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

export const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

/** Consumi di un turno da contatori di token (nomi diversi per agente). */
export function usageOf(
  u: Record<string, unknown>,
  keys: { input: string; output: string; cacheRead?: string },
  durationMs = 0,
): AgentUsage {
  return {
    durationMs,
    inputTokens: num(u[keys.input]),
    outputTokens: num(u[keys.output]),
    cacheReadTokens: keys.cacheRead ? num(u[keys.cacheRead]) : 0,
    cacheWriteTokens: 0,
    turns: 1,
  };
}

const MAX_TEXT = 2000;
const MAX_DETAIL = 200;
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

export const textActivity = (text: string) => ({
  kind: 'text' as const,
  text: clip(text.trim(), MAX_TEXT),
});

export const toolActivity = (tool: string, detail: string) => ({
  kind: 'tool' as const,
  tool,
  text: clip(detail.split('\n')[0] ?? '', MAX_DETAIL),
});

/**
 * Verifiche comuni: l'agente risponde a `--version`; l'accesso c'è se è impostata una delle
 * variabili o esiste uno dei file (relativi alla home).
 */
export async function cliChecks(
  id: string,
  command: string[],
  env: NodeJS.ProcessEnv,
  auth: { env: string[]; files: string[] },
): Promise<Check[]> {
  const res = await run([...command, '--version'], { env, timeout: TIMEOUT, windowsHide: true });
  const version = res.code === 0 ? res.stdout.trim().split(/\r?\n/)[0] || null : null;
  const byEnv = auth.env.find((k) => env[k]);
  const byFile = auth.files.map((f) => join(homedir(), f)).find((f) => existsSync(f));
  const access = byEnv ?? byFile;
  return [
    { id, ok: version !== null, severity: 'error', detail: version ?? command.join(' ') },
    {
      id: `${id}.auth`,
      ok: access !== undefined,
      severity: 'warn',
      ...(access && { detail: access }),
    },
  ];
}

/**
 * Risposta testuale con un turno senza sessione, in una cartella vuota e temporanea: così
 * l'agente non legge né tocca nessun progetto.
 */
export function turnAssistant(driver: () => AgentDriver): Assistant {
  return async (prompt) => {
    const agent = driver();
    const cwd = mkdtempSync(join(tmpdir(), 'jeko-assist-'));
    try {
      const { args, env } = agent.turn({ dir: cwd, prompt, resume: false });
      const res = await run([...agent.command, ...args], {
        cwd,
        stdin: prompt,
        windowsHide: true,
        ...(env && { env: { ...process.env, ...env } }),
      });
      const out = agent.parseStream(res.stdout);
      if (!out) throw new Error(res.stderr.trim() || `${agent.label} non ha risposto`);
      if (!out.ok) throw new Error(out.output || `${agent.label} non ha risposto`);
      return out.output;
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  };
}
