/* global setTimeout */
// claude finto per il video dimostrativo: scrive stream-json come `claude -p --output-format stream-json`,
// con attività e risposte scritte a mano secondo il passo del workflow.
// DEMO_DIR/fast presente: niente pause (per preparare i dati).
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);
const fast = process.env.DEMO_DIR && existsSync(join(process.env.DEMO_DIR, 'fast'));
const sleep = (ms) => new Promise((r) => setTimeout(r, fast ? 0 : ms));

// Un turno usa i file accanto a --mcp-config (prompt-N.txt, out-N.jsonl): avviato staccato
// tramite claude.cmd, il processo non riceve lo stdin e lo stdout che il runner gli passa.
const turn = (() => {
  if (!args.includes('--mcp-config')) return null;
  const dir = dirname(args[args.indexOf('--mcp-config') + 1]);
  const n = Math.max(
    0,
    ...readdirSync(dir).map((f) => Number(/^prompt-(\d+)\.txt$/.exec(f)?.[1] ?? 0)),
  );
  return n ? { prompt: join(dir, `prompt-${n}.txt`), out: join(dir, `out-${n}.jsonl`) } : null;
})();
const out = (m) =>
  turn
    ? appendFileSync(turn.out, `${JSON.stringify(m)}\n`)
    : process.stdout.write(`${JSON.stringify(m)}\n`);

if (args.includes('--version')) {
  process.stdout.write('2.5.0 (Claude Code)\n');
  process.exit(0);
}

const stdin = turn ? readFileSync(turn.prompt, 'utf8') : '';
const model = args.includes('--model') ? args[args.indexOf('--model') + 1] : 'claude-sonnet-5-5';

// Risposta testuale semplice (`--output-format json`).
if (args.includes('json')) {
  out({ type: 'result', result: 'Fatto.', is_error: false });
  process.exit(0);
}

const flag = args.includes('--resume') ? '--resume' : '--session-id';
const session = args[args.indexOf(flag) + 1];

const request = (/Richiesta: (.+)/.exec(stdin) ?? /richiesta: (.+)/.exec(stdin))?.[1] ?? stdin;
const topic = (s) => request.toLowerCase().includes(s);

function plan() {
  if (topic('ricerca'))
    return {
      tools: [
        ['Grep', { pattern: 'ricette|recipes' }],
        ['Read', { file_path: 'src/app/ricette/elenco.component.ts' }],
        ['Read', { file_path: 'src/app/ricette/ricette.service.ts' }],
        ['Glob', { pattern: 'src/app/**/*.spec.ts' }],
      ],
      text: "Piano:\n1. ricette.service.ts: nuovo metodo cerca(ingrediente) che filtra senza distinguere maiuscole e accenti.\n2. elenco.component.ts: campo di ricerca sopra l'elenco, con un breve ritardo mentre si scrive.\n3. Test per il filtro e per il campo.\n\nNessun file modificato finora.",
    };
  return {
    tools: [
      ['Grep', { pattern: request.split(' ').slice(-1)[0] }],
      ['Read', { file_path: 'src/index.ts' }],
    ],
    text: `Piano:\n1. Modifica mirata dei file coinvolti.\n2. Test aggiornati.\n\nRichiesta: ${request}`,
  };
}

function implement() {
  if (topic('ricerca'))
    return {
      tools: [
        ['Edit', { file_path: 'src/app/ricette/ricette.service.ts' }],
        ['Edit', { file_path: 'src/app/ricette/elenco.component.ts' }],
        ['Edit', { file_path: 'src/app/ricette/elenco.component.html' }],
        ['Write', { file_path: 'src/app/ricette/ricette.service.spec.ts' }],
        ['Bash', { command: 'npm test -- ricette' }],
      ],
      text: "Ricerca per ingrediente aggiunta all'elenco, con 6 test nuovi. Tutti i test passano.",
    };
  return {
    tools: [
      ['Edit', { file_path: 'src/index.ts' }],
      ['Bash', { command: 'npm test' }],
    ],
    text: 'Modifica fatta, test aggiornati e verdi.',
  };
}

const knowledge = () => ({
  tools: [
    ['Read', { file_path: '.jeko/project.md' }],
    ['Write', { file_path: '.jeko/notes/ricerca.md' }],
  ],
  text: 'Aggiunta una nota in .jeko/notes/ sulla normalizzazione degli accenti.',
});

const direct = () => ({
  tools: [['Read', { file_path: 'README.md' }]],
  text: 'Fatto.',
});

const step = stdin.includes('scrivi un piano breve')
  ? plan()
  : stdin.includes('Implementa il piano')
    ? implement()
    : stdin.includes('Aggiorna la conoscenza')
      ? knowledge()
      : direct();

out({ type: 'system', subtype: 'init', session_id: session, model, tools: [], mcp_servers: [] });
await sleep(900);
for (const [name, input] of step.tools) {
  out({ type: 'assistant', message: { content: [{ type: 'tool_use', name, input }] } });
  await sleep(1100);
}
out({ type: 'assistant', message: { content: [{ type: 'text', text: step.text }] } });
await sleep(600);

const seed = [...request].reduce((a, c) => a + c.charCodeAt(0), stdin.length);
const r = (n) => ((seed * 9301 + n * 49297) % 233280) / 233280;
out({
  type: 'result',
  result: step.text,
  is_error: false,
  session_id: session,
  duration_ms: Math.round(20000 + r(1) * 90000),
  total_cost_usd: Number((0.05 + r(2) * 0.6).toFixed(4)),
  usage: {
    input_tokens: Math.round(200 + r(3) * 3000),
    output_tokens: Math.round(400 + r(4) * 4000),
    cache_read_input_tokens: Math.round(20000 + r(5) * 200000),
    cache_creation_input_tokens: Math.round(5000 + r(6) * 40000),
  },
});
