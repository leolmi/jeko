import { buildApp } from './app.js';
import { createPgDb } from './db/db.js';
import { migrate } from './db/migrate.js';

const db = createPgDb(process.env.DATABASE_URL ?? 'postgres://localhost:5432/jeko');
await migrate(db);

const app = await buildApp({ db, logger: true });
await app.listen({ host: '127.0.0.1', port: Number(process.env.PORT ?? 4310) });
