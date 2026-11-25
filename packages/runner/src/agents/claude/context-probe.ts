import type { ContextInventory } from '@jeko/shared';
import { parseInit } from './cli.js';
import { MCP_SERVER_NAME } from '../../permissions/protocol.js';
import { killTree } from '../../process.js';
import { spawnArgv } from '../../spawn.js';
import type { ContextProbe } from '../driver.js';

const PROBE_TIMEOUT_MS = 60_000;
/**
 * claude scrive l'`init` appena legge il prompt, anche se non ha ancora finito di caricare
 * i server MCP di claude.ai: aspettando un po' prima di mandarlo, l'elenco arriva completo.
 */
const PROMPT_DELAY_MS = 3_000;

/**
 * Avvia claude nella cartella e lo chiude appena manda il messaggio `init`, che elenca
 * strumenti, server MCP, plugin e skill. Senza un prompt l'`init` non arriva: si manda il
 * più corto possibile, con haiku, e si chiude prima della risposta (costo trascurabile).
 * Il prompt parte dopo {@link PROMPT_DELAY_MS}, così l'`init` include i server di claude.ai.
 */
export function claudeContextProbe(claude: string[]): ContextProbe {
  return (cwd) =>
    new Promise((resolve, reject) => {
      const args = ['-p', '--output-format', 'stream-json', '--verbose', '--model', 'haiku'];
      const child = spawnArgv([...claude, ...args], {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });
      let out = '';
      let err = '';
      let done = false;
      const finish = (result: ContextInventory | Error) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        clearTimeout(send);
        if (child.pid !== undefined && child.exitCode === null) killTree(child.pid);
        if (result instanceof Error) reject(result);
        else resolve(result);
      };
      const timer = setTimeout(() => finish(new Error('claude non ha risposto')), PROBE_TIMEOUT_MS);
      const send = setTimeout(() => child.stdin?.end('ok'), PROMPT_DELAY_MS);
      child.stdout?.on('data', (d: Buffer) => {
        out += d.toString('utf8');
        const lines = out.split('\n');
        out = lines.pop() ?? '';
        for (const line of lines) {
          const inv = parseInit(line, MCP_SERVER_NAME);
          if (inv) return finish(inv);
        }
      });
      child.stderr?.on('data', (d: Buffer) => (err += d.toString('utf8')));
      child.on('error', (e) => finish(e));
      child.on('close', (code) =>
        finish(new Error(err.trim() || `claude è uscito con ${code ?? '?'} senza l'elenco`)),
      );
    });
}
