import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { defaultDbDir, openDb } from './db/db.js';
import { migrate } from './db/migrate.js';
import { WorkflowStore } from './workflows/store.js';

// Postgres incorporato su disco, o quello di DATABASE_URL (es. docker-compose.yml).
const db = await openDb();
await migrate(db);

// Workflow di serie (da src/ o dist/ la cartella è la stessa).
const builtinDir = fileURLToPath(new URL('../../shared/workflows/', import.meta.url));
const yamls = readdirSync(builtinDir)
  .filter((f) => f.endsWith('.yaml'))
  .map((f) => readFileSync(join(builtinDir, f), 'utf8'));
await new WorkflowStore(db).seed(yamls);

const port = Number(process.env.PORT ?? 4310);
const app = await buildApp({ db, logger: true, serverUrl: `http://127.0.0.1:${port}` });
await app.listen({ host: '127.0.0.1', port });
app.log.info(`Database: ${process.env.DATABASE_URL ? 'DATABASE_URL' : defaultDbDir()}`);

// Chiusura ordinata: il database incorporato va chiuso prima di uscire.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().finally(() => process.exit(0));
  });
}
