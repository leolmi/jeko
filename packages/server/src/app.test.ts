import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.js';

describe('server', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp({ dataDir: mkdtempSync(join(tmpdir(), 'jeko-app-')) });
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
    const formats = { date: 'ymd', time: 'h24', currency: 'EUR', rates: { EUR: 0.91 } };
    expect((await put({ projectsDir: 'p', formats })).json()).toEqual({
      projectsDir: 'p',
      formats,
    });
    expect((await put({ formats: { currency: 'XYZ' } })).statusCode).toBe(400);
    expect((await put({ formats: { rates: { EUR: 0 } } })).statusCode).toBe(400);
  });

  it('gestisce il primo avvio', async () => {
    const first = (await app.inject('/api/setup')).json();
    expect(first).toMatchObject({
      completed: false,
      server: { workflows: 0 },
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
    // Si continua solo da un task diretto chiuso, con una sessione di claude.
    const from = (direct.json() as { id: string }).id;
    const forked = (payload: object) =>
      app.inject({
        method: 'POST',
        url: '/api/runs',
        payload: { request: 'ancora', mode: 'checkpoint', cwd: 'c:/dev/p', from, ...payload },
      });
    expect((await forked({ direct: true })).statusCode).toBe(400);
    expect((await forked({})).statusCode).toBe(400);

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

  it('ragionamento e modello: quelli del task sopra quelli del progetto', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'jeko-agent-'));
    const a = await buildApp({ dataDir });
    try {
      const { id } = (
        await a.inject({
          method: 'POST',
          url: '/api/projects',
          payload: { name: 'P', path: 'C:\\dev\\p' },
        })
      ).json() as { id: string };
      const patch = (agent: object) =>
        a.inject({ method: 'PATCH', url: `/api/projects/${id}`, payload: { agent } });
      expect((await patch({ effort: 'nessuno' })).statusCode).toBe(400);
      expect((await patch({ effort: 'high', model: 'opus' })).json()).toMatchObject({
        agent: { effort: 'high', model: 'opus' },
      });
      const start = async (payload: object) => {
        const res = await a.inject({
          method: 'POST',
          url: '/api/runs',
          payload: { request: 'x', mode: 'headless', direct: true, ...payload },
        });
        const run = (res.json() as { id: string }).id;
        const file = join(dataDir, 'runs', run, 'run.json');
        return (JSON.parse(readFileSync(file, 'utf8')) as { agent: unknown }).agent;
      };
      expect(await start({ cwd: 'c:/dev/p', agent: { model: 'haiku' } })).toEqual({
        effort: 'high',
        model: 'haiku',
      });
      expect(await start({ cwd: 'C:\\altro' })).toBeNull();
      // `{}` torna a quelli di claude.
      expect((await patch({})).json()).not.toHaveProperty('agent');
    } finally {
      await a.close();
    }
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

describe('dati su file', () => {
  it('progetti, opzioni, workflow e run restano dopo un riavvio', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'jeko-files-'));
    const first = await buildApp({ dataDir });
    await first.inject({
      method: 'POST',
      url: '/api/projects',
      payload: { name: 'P', path: 'C:\\p' },
    });
    await first.inject({
      method: 'PUT',
      url: '/api/settings',
      payload: { projectsDir: 'C:\\dev' },
    });
    const yaml =
      "name: w\nkind: develop\nversion: 1\nsteps:\n  - id: a\n    type: check\n    expect: 'true'\n";
    await first.inject({ method: 'POST', url: '/api/workflows', payload: { yaml } });
    await first.inject({ method: 'POST', url: '/api/workflows', payload: { yaml } });
    const run = (
      await first.inject({
        method: 'POST',
        url: '/api/runs',
        payload: { workflow: 'w', request: 'x', mode: 'headless' },
      })
    ).json() as { id: string };
    await first.close();

    const again = await buildApp({ dataDir });
    expect((await again.inject('/api/projects')).json()).toMatchObject([
      { name: 'P', path: 'C:\\p' },
    ]);
    expect((await again.inject('/api/settings')).json()).toEqual({ projectsDir: 'C:\\dev' });
    expect((await again.inject('/api/workflows/w')).json()).toMatchObject([
      { version: 2, yaml },
      { version: 1 },
    ]);
    expect((await again.inject(`/api/runs/${run.id}`)).json()).toMatchObject({
      status: 'queued',
      events: [],
      prompts: [],
    });
    await again.close();
  });

  it('rifiuta le richieste da pagine di altri siti', async () => {
    const app = await buildApp({ dataDir: mkdtempSync(join(tmpdir(), 'jeko-origin-')) });
    const get = (origin: string) => app.inject({ url: '/api/projects', headers: { origin } });
    expect((await get('https://evil.example')).statusCode).toBe(403);
    expect((await get('http://localhost:4200')).statusCode).toBe(200);
    expect((await get('http://127.0.0.1:4310')).statusCode).toBe(200);
    await app.close();
  });

  it('serve la web-app, con index.html per le sue rotte', async () => {
    const adminDir = mkdtempSync(join(tmpdir(), 'jeko-admin-'));
    writeFileSync(join(adminDir, 'index.html'), '<html>jeko</html>');
    writeFileSync(join(adminDir, 'main.js'), 'x');
    const app = await buildApp({ dataDir: mkdtempSync(join(tmpdir(), 'jeko-static-')), adminDir });
    expect((await app.inject('/')).body).toBe('<html>jeko</html>');
    expect((await app.inject('/workflows/qualcosa')).body).toBe('<html>jeko</html>');
    expect((await app.inject('/main.js')).headers['content-type']).toContain('javascript');
    expect((await app.inject('/manca.js')).statusCode).toBe(404);
    expect((await app.inject('/api/manca')).statusCode).toBe(404);
    expect((await app.inject('/..%2f..%2fsegreto.txt')).statusCode).toBe(404);
    await app.close();
  });
});

describe('finestre dell’app desktop', () => {
  const info = { nlPort: '5000', nlToken: 't', nlConnectToken: 'c', nlExtensionId: 'e' };

  it('collega al servizio acceso una finestra aperta dopo', async () => {
    const attachWindow = vi.fn();
    const control = { updater: {} as never, restart: vi.fn(), attachWindow };
    const app = await buildApp({ dataDir: mkdtempSync(join(tmpdir(), 'jeko-app-')), control });
    const res = await app.inject({ method: 'POST', url: '/api/app/window', payload: info });
    expect(res.statusCode).toBe(204);
    expect(attachWindow).toHaveBeenCalledWith(info);
    await app.close();
  });

  it('fuori dall’app desktop non collega niente', async () => {
    const app = await buildApp({ dataDir: mkdtempSync(join(tmpdir(), 'jeko-app-')) });
    const res = await app.inject({ method: 'POST', url: '/api/app/window', payload: info });
    expect(res.statusCode).toBe(409);
    await app.close();
  });
});
