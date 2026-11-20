import { PGlite } from '@electric-sql/pglite';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import type { Db } from './db/db.js';
import { migrate } from './db/migrate.js';

function pgliteDb(): Db {
  const pg = new PGlite();
  return {
    query: async <R>(sql: string, params?: unknown[]) => {
      const res = await pg.query<R>(sql, params);
      return { rows: res.rows };
    },
    close: () => pg.close(),
  };
}

describe('server', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    const db = pgliteDb();
    await migrate(db);
    app = await buildApp({ db });
  });

  afterEach(() => app.close());

  it('risponde a /api/health', async () => {
    const res = await app.inject('/api/health');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok' });
  });

  it('crea e legge un progetto', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'Jeko' },
    });
    expect(created.statusCode).toBe(201);
    const list = await app.inject('/api/projects');
    expect(list.json()).toEqual([created.json()]);
  });

  it('rifiuta un body non valido', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/projects', payload: { name: '' } });
    expect(res.statusCode).toBe(400);
  });
});
