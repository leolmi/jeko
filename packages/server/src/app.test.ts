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

  it("salva e rilegge le opzioni dell'utente", async () => {
    expect((await app.inject('/api/settings')).json()).toEqual({});
    const put = (payload: object) => app.inject({ method: 'PUT', url: '/api/settings', payload });
    expect((await put({ projectsDir: 'progetti' })).json()).toEqual({ projectsDir: 'progetti' });
    expect((await app.inject('/api/settings')).json()).toEqual({ projectsDir: 'progetti' });
    expect((await put({ projectsDir: '' })).statusCode).toBe(400);
    // I campi sconosciuti si scartano (Fastify, removeAdditional).
    expect((await put({ projectsDir: 'p', altro: 1 })).json()).toEqual({ projectsDir: 'p' });
  });

  it('gestisce il primo avvio', async () => {
    const first = (await app.inject('/api/setup')).json();
    expect(first).toMatchObject({
      completed: false,
      server: { database: true, workflows: 0 },
      runner: { connected: false, checks: null },
    });
    expect((await app.inject({ method: 'POST', url: '/api/setup/checks' })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: '/api/setup/complete' })).statusCode).toBe(204);
    expect((await app.inject('/api/setup')).json()).toMatchObject({ completed: true });
    await app.inject({ method: 'DELETE', url: '/api/setup/complete' });
    expect((await app.inject('/api/setup')).json()).toMatchObject({ completed: false });
  });

  it('rifiuta un body non valido', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/projects', payload: { name: '' } });
    expect(res.statusCode).toBe(400);
  });
});
