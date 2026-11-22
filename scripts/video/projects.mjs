/* global fetch, setTimeout */
// Immagine dei progetti di Jeko (docs/jeko-progetti.png) con i dati finti di demo.mjs e
// qualche task aperto: in attesa dell'utente, al lavoro e in coda, nelle due modalità.
// Uso: node scripts/video/projects.mjs
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { PORT, prepare } from './demo.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, '..', '..', 'docs', 'jeko-progetti.png');
const api = `http://127.0.0.1:${PORT}/api`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, path, body) {
  const res = await fetch(api + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

/** Attende che il task arrivi a uno degli stati dati. */
async function until(id, statuses) {
  for (let i = 0; i < 120; i++) {
    const run = await call('GET', `/runs/${id}`);
    if (statuses.includes(run.status)) return run;
    await sleep(250);
  }
  throw new Error(`il task ${id} non arriva a ${statuses.join('/')}`);
}

const server = await prepare();
process.on('exit', () => server.kill());
const projects = await call('GET', '/projects');
const path = (name) => projects.find((p) => p.name === name).path;
const start = (name, request, mode, direct) =>
  call('POST', '/runs', { request, mode, cwd: path(name), ...(direct && { direct: true }) });

// ricettario: workflow fermo al gate del piano, più un task diretto in coda.
const gate = await start(
  'ricettario',
  "Aggiungi la ricerca per ingrediente nell'elenco delle ricette",
  'checkpoint',
);
await until(gate.id, ['waiting']);
await start('ricettario', 'Aggiorna le dipendenze', 'checkpoint', true);
// bilancio-casa: task diretto che aspetta il seguito dell'utente.
const direct = await start('bilancio-casa', 'Spiega come è organizzato il codice', 'checkpoint', true);
await until(direct.id, ['waiting']);
// magazzino: workflow autonomo al lavoro mentre si scatta l'immagine.
const busy = await start('magazzino', 'Storico dei movimenti per articolo', 'headless');
await until(busy.id, ['running']);

console.info('task aperti pronti, apro Edge');
const browser = await chromium.launch({ channel: 'msedge', timeout: 60000 });
try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    colorScheme: 'dark',
    locale: 'it-IT',
  });
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.getByRole('button', { name: /ricettario/ }).click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: target });
  console.info(`immagine: ${target}`);
} finally {
  await browser.close();
  server.kill();
  process.exit(0);
}
