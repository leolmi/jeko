import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../../spawn.js';
import type { Assistant } from '../driver.js';

/** Testo del risultato di `claude -p --output-format json`. */
export function parseResult(stdout: string): string {
  let msg: { result?: unknown; is_error?: unknown };
  try {
    msg = JSON.parse(stdout) as typeof msg;
  } catch {
    throw new Error('Uscita di claude non leggibile');
  }
  if (msg.is_error === true || typeof msg.result !== 'string')
    throw new Error(typeof msg.result === 'string' ? msg.result : 'claude non ha risposto');
  return msg.result;
}

/**
 * Un turno di claude solo testo: il prompt da stdin, in una cartella vuota e temporanea,
 * così non legge né tocca nessun progetto.
 */
export function claudeAssistant(claude: string[]): Assistant {
  return async (prompt) => {
    const cwd = mkdtempSync(join(tmpdir(), 'jeko-assist-'));
    try {
      const res = await run([...claude, '-p', '--output-format', 'json'], {
        cwd,
        stdin: prompt,
        windowsHide: true,
      });
      if (res.code !== 0 && !res.stdout.trim())
        throw new Error(res.stderr.trim() || `claude è uscito con ${res.code}`);
      return parseResult(res.stdout);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  };
}
