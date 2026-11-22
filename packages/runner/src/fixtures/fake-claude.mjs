/* global process, setTimeout */
// claude finto per i test dei turni: scrive stream-json come `claude -p --output-format stream-json`.
// FAKE_LOG: file in cui annotare ogni avvio; FAKE_SLEEP: ms prima del risultato;
// FAKE_DIE=1: il primo avvio muore senza risultato; FAKE_LINGER: vedi in fondo.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const stdin = readFileSync(0, 'utf8');
const log = process.env.FAKE_LOG;
const runs =
  log && existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).length : 0;
if (log) appendFileSync(log, `${JSON.stringify({ args, stdin })}\n`);

const flag = args.includes('--resume') ? '--resume' : '--session-id';
const session = args[args.indexOf(flag) + 1];
const out = (m) => process.stdout.write(`${JSON.stringify(m)}\n`);

out({ type: 'system', subtype: 'init', session_id: session });
out({
  type: 'assistant',
  message: {
    content: [
      { type: 'text', text: 'Al lavoro' },
      { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } },
    ],
  },
});
if (process.env.FAKE_DIE === '1' && runs === 0) process.exit(1);
await new Promise((r) => setTimeout(r, Number(process.env.FAKE_SLEEP ?? 0)));
out({ type: 'result', result: `eco: ${stdin}`, is_error: false, session_id: session });
// FAKE_LINGER: ms in cui resta vivo dopo il risultato (come claude con task in background).
if (process.env.FAKE_LINGER) await new Promise((r) => setTimeout(r, Number(process.env.FAKE_LINGER)));
