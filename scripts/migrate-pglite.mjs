// Migrazione una tantum dal database PGlite (versioni fino alla 0.1) ai dati su file.
//
//   npm run migrate:pglite -- [cartella-db] [cartella-dati] [--force]
//
// Predefiniti: %LOCALAPPDATA%\jeko\db → %LOCALAPPDATA%\jeko\data. Il database originale non
// si tocca: lo script ne apre una copia temporanea. Si rifiuta di scrivere su dati già presenti
// (senza --force). Va eseguito con Jeko chiuso.
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const args = process.argv.slice(2);
const force = args.includes('--force');
const [dbArg, dataArg] = args.filter((a) => !a.startsWith('--'));
const base = process.env.LOCALAPPDATA ?? join(homedir(), '.local', 'share');
const dbDir = dbArg ?? join(base, 'jeko', 'db');
const dataDir = dataArg ?? process.env.JEKO_DATA_DIR ?? join(base, 'jeko', 'data');

if (!existsSync(join(dbDir, 'PG_VERSION'))) throw new Error(`Nessun database PGlite in ${dbDir}`);
if (existsSync(dataDir) && readdirSync(dataDir).length > 0 && !force)
  throw new Error(`${dataDir} contiene già dei dati: usa --force per sovrascriverli`);

const copy = mkdtempSync(join(tmpdir(), 'jeko-migrate-'));
cpSync(dbDir, copy, { recursive: true });
// Una copia presa con il server acceso può avere il lucchetto del vecchio processo.
rmSync(join(copy, 'postmaster.pid'), { force: true });
const pg = await PGlite.create(copy);

const iso = (col) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
const rows = async (sql, params) => (await pg.query(sql, params)).rows;
const tables = new Set(
  (await rows(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`)).map(
    (r) => r.tablename,
  ),
);
const has = (t) => tables.has(t);

const write = (rel, value) => {
  const file = join(dataDir, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
  return file;
};

if (force) rmSync(dataDir, { recursive: true, force: true });
mkdirSync(dataDir, { recursive: true });
const count = {};

// Impostazioni: tutto tranne il token del runner, che non esiste più.
const settings = {};
if (has('settings'))
  for (const { key, value } of await rows(`SELECT key, value FROM settings ORDER BY key`))
    if (key !== 'runner.token') settings[key] = value;
write('settings.json', settings);
count.impostazioni = Object.keys(settings).length;

const projects = has('projects')
  ? await rows(
      `SELECT id, name, path, workflow, ${iso('created_at')} AS "createdAt" FROM projects ORDER BY created_at`,
    )
  : [];
write('projects.json', projects);
count.progetti = projects.length;

const templates = has('project_templates')
  ? await rows(
      `SELECT name, prompt, ${iso('updated_at')} AS "updatedAt" FROM project_templates ORDER BY lower(name)`,
    )
  : [];
write('templates.json', templates);
count.template = templates.length;

const workflows = has('workflows')
  ? await rows(
      `SELECT name, version, kind, description, yaml, ${iso('created_at')} AS "createdAt" FROM workflows ORDER BY name, version`,
    )
  : [];
write(
  'workflows.json',
  workflows.map(({ yaml: _, description, ...w }) => ({
    ...w,
    ...(description !== null && { description }),
  })),
);
for (const w of workflows) {
  const file = write(join('workflows', w.name, `${w.version}.yaml`), w.yaml);
  const at = new Date(w.createdAt);
  utimesSync(file, at, at);
}
count.workflow = workflows.length;

const runs = has('runs')
  ? await rows(
      `SELECT id, workflow_name AS workflow, workflow_version AS version, request, mode, status, error,
              cwd, inputs, state, definition, ${iso('created_at')} AS "createdAt", ${iso('updated_at')} AS "updatedAt"
       FROM runs ORDER BY created_at`,
    )
  : [];
const hasRunnerSeq =
  has('run_events') &&
  (
    await rows(
      `SELECT 1 FROM information_schema.columns WHERE table_name = 'run_events' AND column_name = 'runner_seq'`,
    )
  ).length > 0;
let events = 0;
for (const r of runs) {
  const prompts = has('run_prompts')
    ? await rows(
        `SELECT id, run_id AS "runId", prompt, answer, status, ${iso('created_at')} AS "createdAt",
                CASE WHEN answered_at IS NULL THEN NULL ELSE ${iso('answered_at')} END AS "answeredAt"
         FROM run_prompts WHERE run_id = $1 ORDER BY created_at`,
        [r.id],
      )
    : [];
  write(join('runs', r.id, 'run.json'), {
    ...r,
    definition: r.definition ?? null,
    prompts: prompts.map(({ answeredAt, ...p }) => ({ ...p, ...(answeredAt && { answeredAt }) })),
  });
  const list = has('run_events')
    ? await rows(
        `SELECT seq::int AS seq, ${hasRunnerSeq ? 'runner_seq' : 'NULL'} AS "runnerSeq", event, ${iso('created_at')} AS at
         FROM run_events WHERE run_id = $1 ORDER BY seq`,
        [r.id],
      )
    : [];
  // Numeri per run da 1; senza numero del runner (eventi vecchi) uno negativo, che non si ripete.
  const lines = list.map((e, i) =>
    JSON.stringify({ seq: i + 1, event: e.event, at: e.at, runnerSeq: e.runnerSeq ?? -(i + 1) }),
  );
  if (lines.length) write(join('runs', r.id, 'events.jsonl'), `${lines.join('\n')}\n`);
  events += lines.length;
}
count.run = runs.length;
count.eventi = events;

await pg.close();
rmSync(copy, { recursive: true, force: true });
console.log(`Dati migrati in ${dataDir}:`);
for (const [k, v] of Object.entries(count)) console.log(`  ${k}: ${v}`);
console.log(`Il database originale è ancora in ${dbDir}: cancellalo quando hai verificato.`);
