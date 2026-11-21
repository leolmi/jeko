/* global setTimeout, fetch */
// Jeko con dati finti, per il video dimostrativo (vedi record.mjs).
// Crea in %TEMP%\jeko-demo progetti e task di esempio, fatti girare con un claude finto,
// poi lascia acceso il servizio su http://127.0.0.1:4321 (Ctrl+C per fermarlo).
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const demo = join(tmpdir(), 'jeko-demo');
const data = join(demo, 'data');
// Progetti in una cartella senza il nome dell'utente: il percorso si vede nel video.
const dirs = join(process.env.PUBLIC ?? demo, 'jeko-demo');
export const PORT = 4321;
const api = `http://127.0.0.1:${PORT}/api`;

// Progetti con le richieste dei task già fatti (le richieste con "migrazione" falliscono).
const PROJECTS = [
  {
    name: 'ricettario',
    about: 'Web-app Angular per raccogliere e cercare ricette.',
    requests: [
      'Pagina di dettaglio della ricetta con le dosi per persona',
      'Salvataggio delle ricette preferite',
      'Foto della ricetta con anteprima ridotta',
      'Lista della spesa generata dalle ricette della settimana',
      'Correggi lo scorrimento dell’elenco su mobile',
      'Tempi di preparazione e cottura nella scheda',
      'Stampa della ricetta senza menu e pulsanti',
      'Migrazione dei dati delle ricette al nuovo formato',
    ],
  },
  {
    name: 'bilancio-casa',
    about: 'API Node (Fastify + PostgreSQL) per le spese di casa.',
    requests: [
      'Aggiungi le categorie di spesa con colore e icona',
      'Esportazione CSV delle spese del mese',
      'Correggi il totale quando si elimina una spesa ricorrente',
      'Grafico delle spese per categoria',
      'Budget mensile con avviso al superamento',
      'Importazione dell’estratto conto in formato OFX',
      'Migrazione dello schema a PostgreSQL 18',
      'Ripartizione delle spese tra i componenti della famiglia',
    ],
  },
  {
    name: 'meteo-cli',
    about: 'Libreria TypeScript e CLI per le previsioni del tempo.',
    requests: [
      'Correggi il fuso orario nelle previsioni orarie',
      'Opzione --unita per scegliere tra °C e °F',
      'Cache delle risposte per 10 minuti',
      'Messaggio chiaro quando la città non esiste',
      'Previsioni a 7 giorni in tabella',
      'Completamento automatico dei comandi per PowerShell',
    ],
  },
  {
    name: 'sito-studio',
    about: 'Sito statico (Astro) di uno studio professionale.',
    requests: [
      'Modulo contatti con verifica anti-spam',
      'Pagina dei servizi con le schede',
      'Migliora i punteggi di Lighthouse su mobile',
      'Versione inglese delle pagine principali',
      'Mappa dello studio nella pagina contatti',
    ],
  },
  {
    name: 'magazzino',
    about: 'Monorepo Nx (NestJS + Angular) per la gestione del magazzino.',
    requests: [
      'Scorte minime con avviso di riordino',
      'Lettura dei codici a barre dalla fotocamera',
      'Storico dei movimenti per articolo',
      'Correggi l’arrotondamento delle giacenze',
      'Report mensile in PDF',
      'Ruoli utente: magazziniere e amministratore',
      'Inventario con conteggio a più persone',
    ],
  },
];

// Task già fatti negli ultimi 30 giorni: [progetto, richiesta, giorni fa, approvato, diretto].
const HISTORY = (() => {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const out = [];
  for (let day = 29; day >= 0; day--) {
    const weekend = [0, 6].includes(new Date(Date.now() - day * 86400000).getDay());
    const count = Math.round(rnd() * (weekend ? 1.5 : 4.5));
    for (let i = 0; i < count; i++) {
      const p = PROJECTS[Math.floor(rnd() * PROJECTS.length)];
      const direct = rnd() < 0.2;
      const request = direct
        ? [
            'Aggiorna le dipendenze',
            'Spiega come è organizzato il codice',
            'Rinomina le variabili poco chiare',
          ][Math.floor(rnd() * 3)]
        : p.requests[Math.floor(rnd() * p.requests.length)];
      out.push([p.name, request, day + rnd() * 0.4, rnd() > 0.08, direct]);
    }
  }
  return out;
})();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, path, body) {
  let res;
  for (;;) {
    res = await fetch(api + path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status !== 429) break;
    await sleep(Number(res.headers.get('retry-after') ?? 2) * 1000);
  }
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

function project(name, about) {
  const dir = join(dirs, name);
  mkdirSync(join(dir, '.jeko', 'notes'), { recursive: true });
  mkdirSync(join(dir, 'tools'), { recursive: true });
  writeFileSync(join(dir, 'README.md'), `# ${name}\n\n${about}\n`);
  writeFileSync(join(dir, '.jeko', 'project.md'), `# ${name}\n\n${about}\n`);
  writeFileSync(
    join(dir, '.jeko', 'commands.yaml'),
    ['typecheck', 'lint', 'test'].map((c) => `${c}: node tools/check.mjs ${c}`).join('\n') + '\n',
  );
  writeFileSync(
    join(dir, 'tools', 'check.mjs'),
    "import { existsSync } from 'node:fs';\n" +
      "const fast = process.env.DEMO_DIR && existsSync(process.env.DEMO_DIR + '/fast');\n" +
      'setTimeout(() => console.log(`${process.argv[2]}: ok`), fast ? 0 : 1200);\n',
  );
  return dir;
}

function startServer() {
  const child = spawn(process.execPath, [join(root, 'release', 'jeko', 'server', 'jeko.js')], {
    env: {
      ...process.env,
      JEKO_DATA_DIR: data,
      JEKO_RUNNER_DATA: join(demo, 'runner'),
      JEKO_PORT: String(PORT),
      JEKO_CLAUDE_BIN: join(demo, 'claude.cmd'),
      DEMO_DIR: demo,
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  return child;
}

async function waitUp() {
  for (let i = 0; i < 100; i++) {
    try {
      await call('GET', '/app');
      return;
    } catch {
      await sleep(200);
    }
  }
  throw new Error('il servizio non risponde');
}

/** Porta un task alla fine approvando (o rifiutando) le richieste. */
async function finish(id, approved) {
  for (;;) {
    const run = await call('GET', `/runs/${id}`);
    if (['done', 'failed', 'rejected', 'cancelled'].includes(run.status)) return run;
    for (const p of run.prompts ?? []) {
      if (p.status !== 'pending' && p.status !== 'open') continue;
      const answer =
        p.prompt.kind === 'approve'
          ? { kind: 'approve', approved: approved || p.prompt.stepId !== 'commit' }
          : p.prompt.kind === 'review'
            ? { kind: 'review', ok: true }
            : { kind: 'ask', value: '' };
      await call('POST', `/runs/${id}/prompts/${p.id}`, answer).catch(() => {});
    }
    await sleep(1000);
  }
}

/** Sposta le date di task, eventi e progetti come se fossero di giorni diversi. */
function backdate(ages) {
  const shift = (iso, days) => new Date(Date.parse(iso) - days * 86400000).toISOString();
  for (const [id, days] of ages) {
    const dir = join(data, 'runs', id);
    const run = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8'));
    run.createdAt = shift(run.createdAt, days);
    run.updatedAt = shift(run.updatedAt, days);
    for (const p of run.prompts ?? []) if (p.createdAt) p.createdAt = shift(p.createdAt, days);
    writeFileSync(join(dir, 'run.json'), JSON.stringify(run, null, 2));
    const events = readFileSync(join(dir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean);
    writeFileSync(
      join(dir, 'events.jsonl'),
      events
        .map((l) => {
          const e = JSON.parse(l);
          e.at = shift(e.at, days);
          return JSON.stringify(e);
        })
        .join('\n') + '\n',
    );
  }
  const file = join(data, 'projects.json');
  const projects = JSON.parse(readFileSync(file, 'utf8'));
  for (const p of projects) p.createdAt = shift(p.createdAt, 35);
  writeFileSync(file, JSON.stringify(projects, null, 2));
}

async function prepare() {
  if (
    await fetch(`${api}/app`).then(
      () => true,
      () => false,
    )
  )
    throw new Error(`La porta ${PORT} è già occupata: ferma il Jeko demo acceso.`);
  rmSync(demo, { recursive: true, force: true });
  rmSync(dirs, { recursive: true, force: true });
  mkdirSync(data, { recursive: true });
  writeFileSync(join(demo, 'claude.cmd'), `@node "${join(here, 'fake-claude.mjs')}" %*\r\n`);
  writeFileSync(join(demo, 'fast'), '');

  let server = startServer();
  await waitUp();
  await call('POST', '/setup/complete');
  const settings = await call('GET', '/settings');
  await call('PUT', '/settings', {
    ...settings,
    projectsDir: dirs,
    formats: { currency: 'EUR', rates: { EUR: 0.91 }, time: 'h24' },
  });
  const byName = {};
  for (const p of PROJECTS) {
    const created = await call('POST', '/projects', {
      name: p.name,
      path: project(p.name, p.about),
    });
    await call('PATCH', `/projects/${created.id}`, { workflow: 'sviluppo' });
    byName[p.name] = created;
  }
  // Un task alla volta per progetto, i progetti in parallelo.
  const ages = [];
  await Promise.all(
    PROJECTS.map(async (p) => {
      for (const [name, request, days, approved, direct] of HISTORY) {
        if (name !== p.name) continue;
        const run = await call('POST', '/runs', {
          request,
          mode: 'checkpoint',
          cwd: byName[name].path,
          ...(direct && { direct: true }),
        });
        await finish(run.id, approved);
        ages.push([run.id, days]);
      }
    }),
  );
  console.info(`task preparati: ${ages.length}`);
  server.kill();
  await sleep(1500);
  backdate(ages);
  rmSync(join(demo, 'fast'));
  server = startServer();
  await waitUp();
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await prepare();
  console.info(`Jeko (demo) su http://127.0.0.1:${PORT}  dati: ${data}`);
  process.on('SIGINT', () => {
    server.kill();
    process.exit(0);
  });
}

export { prepare, demo };
