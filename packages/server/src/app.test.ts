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

  it('aggiunge, legge e toglie un progetto', async () => {
    const add = (payload: object) => app.inject({ method: 'POST', url: '/api/projects', payload });
    const created = await add({ name: 'Jeko', path: 'C:\\dev\\jeko' });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ name: 'Jeko', path: 'C:\\dev\\jeko' });
    const list = await app.inject('/api/projects');
    expect(list.json()).toEqual([created.json()]);
    // La stessa cartella scritta in un altro modo è già usata.
    expect((await add({ name: 'Altro', path: 'c:/Dev/Jeko/' })).statusCode).toBe(409);

    const id = (created.json() as { id: string }).id;
    const del = () => app.inject({ method: 'DELETE', url: `/api/projects/${id}` });
    expect((await del()).statusCode).toBe(204);
    expect((await del()).statusCode).toBe(404);
    expect((await app.inject('/api/projects')).json()).toEqual([]);
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

  it('i task di un progetto seguono il suo workflow', async () => {
    const save = (name: string, kind = 'develop') =>
      app.inject({
        method: 'POST',
        url: '/api/workflows',
        payload: {
          yaml: `name: ${name}\nkind: ${kind}\nversion: 1\nsteps:\n  - id: a\n    type: check\n    expect: 'true'\n`,
        },
      });
    for (const n of ['b-dev', 'a-dev']) expect((await save(n)).statusCode).toBe(201);
    // I progetti nascono dai template: niente workflow di creazione.
    expect((await save('crea', 'create')).statusCode).toBe(422);

    const project = (
      await app.inject({
        method: 'POST',
        url: '/api/projects',
        payload: { name: 'P', path: 'C:\\dev\\p' },
      })
    ).json() as { id: string; workflow: string | null };
    expect(project.workflow).toBeNull();

    const patch = (workflow: string | null) =>
      app.inject({ method: 'PATCH', url: `/api/projects/${project.id}`, payload: { workflow } });
    const start = async (cwd: string) =>
      (
        await app.inject({
          method: 'POST',
          url: '/api/runs',
          payload: { request: 'x', mode: 'headless', cwd },
        })
      ).json() as { workflow: string };

    // Senza scelta: il predefinito (il primo per nome).
    expect((await start('c:/dev/p')).workflow).toBe('a-dev');
    expect((await patch('crea')).statusCode).toBe(422);
    expect((await patch('nessuno')).statusCode).toBe(422);
    expect((await patch('b-dev')).json()).toMatchObject({ workflow: 'b-dev' });
    expect((await start('c:/dev/p')).workflow).toBe('b-dev');
    expect((await start('C:\\altro')).workflow).toBe('a-dev');
    expect((await patch(null)).json()).toMatchObject({ workflow: null });

    // Task diretto: niente workflow di sviluppo, nemmeno quello del progetto.
    const direct = await app.inject({
      method: 'POST',
      url: '/api/runs',
      payload: { request: 'fai il push', mode: 'checkpoint', cwd: 'c:/dev/p', direct: true },
    });
    expect(direct.statusCode).toBe(201);
    expect(direct.json()).toMatchObject({ workflow: 'diretto', version: 1 });

    // Eliminato: sparisce con le sue versioni e il progetto torna al predefinito.
    expect((await patch('b-dev')).statusCode).toBe(200);
    const del = () => app.inject({ method: 'DELETE', url: '/api/workflows/b-dev' });
    expect((await del()).statusCode).toBe(204);
    expect((await del()).statusCode).toBe(404);
    expect((await app.inject('/api/workflows/b-dev')).statusCode).toBe(404);
    const [p] = (await app.inject('/api/projects')).json() as { workflow: string | null }[];
    expect(p!.workflow).toBeNull();
    expect((await start('c:/dev/p')).workflow).toBe('a-dev');
  });

  it('salva i template e crea un progetto che li segue', async () => {
    const put = (name: string, prompt: string) =>
      app.inject({
        method: 'PUT',
        url: `/api/templates/${encodeURIComponent(name)}`,
        payload: { prompt },
      });
    expect((await put('Angular', 'Usa Angular in {{ dir }}')).json()).toMatchObject({
      name: 'Angular',
      prompt: 'Usa Angular in {{ dir }}',
    });
    expect((await put('Angular', 'Usa Angular {{ name }}')).statusCode).toBe(200);
    // Segnaposto sconosciuto: si dice subito, non a metà della run.
    const bad = await put('Rotto', 'Usa {{ boh }}');
    expect(bad.statusCode).toBe(422);
    expect(bad.json()).toMatchObject({ issues: [{ message: expect.stringContaining('boh') }] });
    expect((await app.inject('/api/templates')).json()).toMatchObject([
      { name: 'Angular', prompt: 'Usa Angular {{ name }}' },
    ]);

    const create = (payload: object) =>
      app.inject({ method: 'POST', url: '/api/projects/create', payload });
    const missing = await create({
      name: 'P',
      request: 'x',
      template: 'Nessuno',
      mode: 'headless',
    });
    expect(missing.statusCode).toBe(404);
    const run = await create({ name: 'P', request: 'x', template: 'Angular', mode: 'headless' });
    expect(run.statusCode).toBe(201);
    expect(run.json()).toMatchObject({ workflow: 'nuovo-progetto', status: 'queued', cwd: null });
    expect((await create({ name: 'Q', request: 'y', mode: 'headless' })).statusCode).toBe(201);

    const del = () => app.inject({ method: 'DELETE', url: '/api/templates/Angular' });
    expect((await del()).statusCode).toBe(204);
    expect((await del()).statusCode).toBe(404);
  });

  it('rifiuta un body non valido', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/projects', payload: { name: '' } });
    expect(res.statusCode).toBe(400);
  });
});
