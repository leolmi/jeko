import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import type { AdminMessage, Project, PromptRecord, RunDetail, RunSummary } from '@jeko/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type JekoApp } from '../../packages/server/src/app.js';
import { RunnerClient } from '../../packages/runner/src/client.js';
import { linkPair, type LinkSocket } from '../../packages/runner/src/link.js';
import type { AgentRequest, Host } from '../../packages/runner/src/engine/engine.js';

const WORKFLOW = `
name: demo
kind: develop
version: 1
inputs:
  nome: { prompt: Come si chiama?, required: true }
policies:
  - { match: git.commit, gate: always }
steps:
  - { id: lavoro, type: agent, instructions: 'Ciao {{ nome }}' }
  - { id: test, type: check, exec: [[node, -e, 'process.exit(0)']] }
  - { id: commit, type: gate, level: always, message: Commit? }
`;

async function until<T>(fn: () => Promise<T | undefined | null | false>, ms = 5000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('run server ↔ runner', () => {
  let app: JekoApp;
  /** Capi lato server delle connessioni del runner, per farle cadere. */
  let links: LinkSocket[];
  let base: string;
  let client: RunnerClient | undefined;
  let others: RunnerClient[];
  let dataDir: string;
  let agentCalls: AgentRequest[];
  /** Cartelle in cui il finto runner ha aperto un terminale. */
  let terminals: string[];
  /** Funzioni dei workflow (exists, fileContains…) del finto host. */
  let functions: Host['functions'];

  const api = async <T>(method: string, url: string, body?: unknown) => {
    const res = await app.inject({
      method: method as 'GET',
      url,
      ...(body !== undefined && { payload: body as object }),
    });
    return { status: res.statusCode, body: (res.body ? res.json() : undefined) as T };
  };
  const detail = async (id: string) => (await api<RunDetail>('GET', `/api/runs/${id}`)).body;
  const pendingPrompt = (id: string) =>
    until(async () => (await detail(id)).prompts.find((p) => p.status === 'pending'));
  const answer = (id: string, p: PromptRecord, a: object) =>
    api('POST', `/api/runs/${id}/prompts/${p.id}`, a);

  const startRunner = () => {
    client = new RunnerClient({
      dataDir,
      connect: () => {
        const [server, runner] = linkPair();
        links.push(server);
        app.jeko.hub.attachRunner(server);
        return runner;
      },
      runnerId: 'test-pc',
      version: '0.0.0',
      reconnectMs: 50,
      log: { info: () => {}, warn: () => {}, error: () => {} },
      // Finto dialogo: "sceglie" una sottocartella di quella di partenza, o annulla.
      pickFolder: async ({ start }) => (start ? `${start}\\scelta` : null),
      openTerminal: async (cwd) => {
        if (cwd.includes('manca')) throw new Error(`Cartella inesistente: ${cwd}`);
        terminals.push(cwd);
      },
      // Finto claude: rimette il workflow attuale con una descrizione nuova.
      assist: async (prompt) => {
        const yaml = /Workflow attuale:\n```yaml\n([\s\S]*?)```/.exec(prompt)![1]!;
        return `SUMMARY: descrizione aggiunta\n\`\`\`yaml\n${yaml}description: Rivisto\n\`\`\``;
      },
      makeHost: (io): Host => ({
        ...io,
        get functions() {
          return functions;
        },
        exec: async () => ({ code: 0, stdout: '', stderr: '' }),
        agent: async (req) => {
          agentCalls.push(req);
          return { ok: true, output: `fatto: ${req.instructions}`, sessionId: 's' };
        },
      }),
    });
    client.start();
  };

  beforeEach(async () => {
    agentCalls = [];
    terminals = [];
    functions = {};
    others = [];
    links = [];
    dataDir = mkdtempSync(join(tmpdir(), 'jeko-e2e-'));
    app = await buildApp({ dataDir: mkdtempSync(join(tmpdir(), 'jeko-e2e-data-')) });
    await app.listen({ host: '127.0.0.1', port: 0 });
    base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    expect((await api('POST', '/api/workflows', { yaml: WORKFLOW })).status).toBe(201);
  });

  afterEach(async () => {
    await client?.stop();
    await Promise.all(others.map((c) => c.stop()));
    client = undefined;
    await app.close();
  });

  it('esegue una run con domanda e gate, fino in fondo', async () => {
    startRunner();
    await until(async () => (await api<{ runner: boolean }>('GET', '/api/health')).body.runner);

    const admin = new WebSocket(`${base.replace('http', 'ws')}/ws/admin`);
    const seen: AdminMessage[] = [];
    admin.on('message', (d) => seen.push(JSON.parse(String(d)) as AdminMessage));

    const created = await api<RunSummary>('POST', '/api/runs', {
      workflow: 'demo',
      request: 'saluta',
      mode: 'checkpoint',
    });
    expect(created.status).toBe(201);
    const id = created.body.id;

    const ask = await pendingPrompt(id);
    expect(ask.prompt).toMatchObject({ kind: 'ask', question: 'Come si chiama?' });
    expect((await api<RunSummary>('GET', `/api/runs/${id}`)).body.status).toBe('waiting');
    expect((await answer(id, ask, { kind: 'approve', approved: true })).status).toBe(400);
    expect((await answer(id, ask, { kind: 'ask', value: 'Ada' })).status).toBe(204);
    expect((await answer(id, ask, { kind: 'ask', value: 'Ada' })).status).toBe(409);

    const gate = await pendingPrompt(id);
    expect(gate.prompt).toMatchObject({ kind: 'approve', stepId: 'commit', reason: 'gate' });
    expect(agentCalls.map((c) => c.instructions)).toEqual(['Ciao Ada']);
    await answer(id, gate, { kind: 'approve', approved: true });

    const done = await until(async () => {
      const d = await detail(id);
      return d.status === 'done' && d;
    });
    expect(done.events.map((e) => e.event.type)).toContain('run.finished');
    expect(done.events.find((e) => e.event.type === 'step.finished')?.event).toMatchObject({
      stepId: 'lavoro',
      output: 'fatto: Ciao Ada',
    });
    await until(async () => seen.some((m) => m.type === 'run.status' && m.status === 'done'));
    expect(seen[0]).toMatchObject({ type: 'runner', connected: true });
    admin.close();
  });

  it('accoda la run senza runner e la avvia quando si collega', async () => {
    const created = await api<RunSummary>('POST', '/api/runs', {
      workflow: 'demo',
      request: 'x',
      mode: 'headless',
      inputs: { nome: 'Ada' },
    });
    expect(created.body.status).toBe('queued');

    startRunner();
    const gate = await pendingPrompt(created.body.id);
    await answer(created.body.id, gate, { kind: 'approve', approved: false, note: 'non ora' });
    const run = await until(async () => {
      const d = await detail(created.body.id);
      return d.status === 'rejected' && d;
    });
    expect(run.error).toBe('non ora');
  });

  it('annulla una run in attesa', async () => {
    startRunner();
    const { body } = await api<RunSummary>('POST', '/api/runs', {
      workflow: 'demo',
      request: 'x',
      mode: 'checkpoint',
    });
    await pendingPrompt(body.id);
    expect((await api('POST', `/api/runs/${body.id}/cancel`)).status).toBe(202);
    const run = await until(async () => {
      const d = await detail(body.id);
      return d.status === 'cancelled' && d;
    });
    expect(run.prompts.every((p) => p.status !== 'pending')).toBe(true);
    expect((await api('POST', `/api/runs/${body.id}/cancel`)).status).toBe(409);
  });

  it('elimina solo i task conclusi, con eventi e richieste', async () => {
    startRunner();
    const start = async () =>
      (
        await api<RunSummary>('POST', '/api/runs', {
          workflow: 'demo',
          request: 'x',
          mode: 'checkpoint',
        })
      ).body;
    const done = await start();
    await pendingPrompt(done.id);
    await api('POST', `/api/runs/${done.id}/cancel`);
    await until(async () => (await detail(done.id)).status === 'cancelled');
    const open = await start();

    const remove = await api<{ removed: string[] }>('POST', '/api/runs/remove', {
      ids: [done.id, open.id],
    });
    expect(remove).toEqual({ status: 200, body: { removed: [done.id] } });
    expect((await api('GET', `/api/runs/${done.id}`)).status).toBe(404);
    expect((await api('GET', `/api/runs/${open.id}`)).status).toBe(200);
  });

  it('sopravvive a una disconnessione del runner mentre attende', async () => {
    startRunner();
    const { body } = await api<RunSummary>('POST', '/api/runs', {
      workflow: 'demo',
      request: 'x',
      mode: 'checkpoint',
    });
    const ask = await pendingPrompt(body.id);

    // La connessione con il runner cade: il client si ricollega da solo.
    for (const l of links) l.terminate();
    await answer(body.id, ask, { kind: 'ask', value: 'Bob' });

    const gate = await until(async () =>
      (await detail(body.id)).prompts.find(
        (p) => p.status === 'pending' && p.prompt.kind === 'approve',
      ),
    );
    await answer(body.id, gate, { kind: 'approve', approved: true });
    await until(async () => (await detail(body.id)).status === 'done');
    expect(agentCalls.map((c) => c.instructions)).toEqual(['Ciao Bob']);
  });

  it('una run alla volta per cartella: le altre aspettano in coda', async () => {
    startRunner();
    const start = (cwd: string) =>
      api<RunSummary>('POST', '/api/runs', {
        workflow: 'demo',
        request: 'x',
        mode: 'checkpoint',
        cwd,
      });
    const status = async (id: string) => (await detail(id)).status;

    const first = (await start('C:\\progetti\\uno')).body;
    await pendingPrompt(first.id);
    // Stessa cartella scritta in un altro modo: resta in coda. Un'altra cartella parte subito.
    const second = (await start('c:/Progetti/uno/')).body;
    const other = (await start('C:\\progetti\\due')).body;
    await pendingPrompt(other.id);
    expect(await status(second.id)).toBe('queued');

    await api('POST', `/api/runs/${first.id}/cancel`);
    await until(async () => (await status(first.id)) === 'cancelled');
    await pendingPrompt(second.id);
    expect(await status(second.id)).toBe('waiting');
  });

  it('una run in coda parte anche se il suo workflow è stato eliminato', async () => {
    const { body } = await api<RunSummary>('POST', '/api/runs', {
      workflow: 'demo',
      request: 'saluta',
      mode: 'checkpoint',
    });
    expect((await api('DELETE', '/api/workflows/demo')).status).toBe(204);
    startRunner();
    await pendingPrompt(body.id);
    expect((await detail(body.id)).status).toBe('waiting');
  });

  it('un progetto creato da un template si aggiunge da solo', async () => {
    // Cartella nuova: non esiste finché non la crea claude; poi .gitignore e .jeko/ ci sono.
    functions = {
      exists: (p) => String(p).endsWith('project.md'),
      fileContains: () => true,
    };
    const tpl = await api('PUT', '/api/templates/Angular', {
      prompt: 'Usa Angular per {{ name }}',
    });
    expect(tpl.status).toBe(200);
    await api('PUT', '/api/settings', { projectsDir: 'C:\\progetti' });
    startRunner();
    const { body } = await api<RunSummary>('POST', '/api/projects/create', {
      name: 'Mio Nuovo',
      request: 'un gestionale',
      template: 'Angular',
      mode: 'headless',
    });
    await until(async () => (await detail(body.id)).status === 'done');
    const projects = await until(async () => {
      const list = (await api<Project[]>('GET', '/api/projects')).body;
      return list.length > 0 && list;
    });
    expect(projects).toMatchObject([{ name: 'Mio Nuovo', path: 'C:\\progetti\\mio-nuovo' }]);
    expect(agentCalls[0]!.instructions).toContain('Usa Angular per Mio Nuovo');
  });

  it('verifica uno YAML senza salvarlo', async () => {
    const check = (yaml: string) =>
      api<{ ok: boolean; issues?: { line?: number }[] }>('POST', '/api/workflows/check', { yaml });
    expect((await check(WORKFLOW)).body).toMatchObject({ ok: true, workflow: { name: 'demo' } });
    const bad = await check('name: x\nkind: develop\nversion: 1\nsteps: []\n');
    expect(bad.body).toMatchObject({ ok: false, issues: [{ line: 4 }] });
    expect((await api('GET', '/api/workflows/demo')).body).toHaveLength(1);
  });

  it("chiede all'AI una modifica del workflow, senza salvarla", async () => {
    const assist = () =>
      api<{ yaml: string; summary: string; issues: unknown[] }>('POST', '/api/workflows/assist', {
        yaml: WORKFLOW,
        request: 'aggiungi una descrizione',
      });
    expect((await assist()).status).toBe(409);

    startRunner();
    await until(async () => (await api<{ runner: boolean }>('GET', '/api/health')).body.runner);
    const res = await assist();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ summary: 'descrizione aggiunta', issues: [] });
    expect(res.body.yaml).toContain('description: Rivisto');
    expect((await api('GET', '/api/workflows/demo')).body).toHaveLength(1);
  });

  it('apre il dialogo della cartella sul PC del runner', async () => {
    const pick = (body: object) =>
      api<{ path: string | null }>('POST', '/api/projects/pick-folder', body);
    expect((await pick({ start: 'C:\\dev' })).status).toBe(409);

    startRunner();
    await until(async () => (await api<{ runner: boolean }>('GET', '/api/health')).body.runner);
    expect(await pick({ start: 'C:\\dev', title: 'Scegli' })).toEqual({
      status: 200,
      body: { path: 'C:\\dev\\scelta' },
    });
    expect((await pick({})).body).toEqual({ path: null });
  });

  it('apre un terminale nella cartella del progetto sul PC del runner', async () => {
    const add = async (path: string) =>
      (await api<{ id: string }>('POST', '/api/projects', { name: path, path })).body.id;
    const open = (id: string) => api('POST', `/api/projects/${id}/terminal`);
    const ok = await add('C:\\dev\\p');
    expect((await open(ok)).status).toBe(409);

    startRunner();
    await until(async () => (await api<{ runner: boolean }>('GET', '/api/health')).body.runner);
    expect((await open(ok)).status).toBe(204);
    expect(terminals).toEqual(['C:\\dev\\p']);
    expect(await open(await add('C:\\manca'))).toMatchObject({
      status: 502,
      body: { message: 'Cartella inesistente: C:\\manca' },
    });
  });

  it('gestisce i prompt del progetto in .jeko/prompts/ tramite il runner', async () => {
    const path = mkdtempSync(join(tmpdir(), 'jeko-progetto-'));
    const { body: p } = await api<{ id: string }>('POST', '/api/projects', { name: 'P', path });
    const url = `/api/projects/${p.id}/prompts`;
    expect((await api('GET', url)).status).toBe(409);

    startRunner();
    await until(async () => (await api<{ runner: boolean }>('GET', '/api/health')).body.runner);
    expect(await api('GET', url)).toEqual({ status: 200, body: [] });
    expect((await api('PUT', `${url}/end-develop`, { text: 'Usa {{ boh }}' })).status).toBe(422);
    expect(await api('PUT', `${url}/end-develop`, { text: 'Chiudi {{ request }}' })).toEqual({
      status: 200,
      body: [{ name: 'end-develop', text: 'Chiudi {{ request }}\n' }],
    });
    expect(readFileSync(join(path, '.jeko', 'prompts', 'end-develop.md'), 'utf8')).toBe(
      'Chiudi {{ request }}\n',
    );
    expect((await api('PUT', `${url}/Nome%20Brutto`, { text: 'x' })).status).toBe(400);
    expect(await api('DELETE', `${url}/end-develop`)).toEqual({ status: 200, body: [] });
  });

  it('rifiuta un workflow non valido con gli errori', async () => {
    const res = await api<{ issues: { line: number }[] }>('POST', '/api/workflows', {
      yaml: 'name: x\nkind: develop\nversion: 1\nsteps: []\n',
    });
    expect(res.status).toBe(422);
    expect(res.body.issues[0]?.line).toBe(4);
    const versions = await api<{ version: number }[]>('POST', '/api/workflows', { yaml: WORKFLOW });
    expect(versions.body).toMatchObject({ version: 2 });
  });

  it('ignora gli eventi reinviati e li conferma comunque', async () => {
    // Le opzioni dell'utente arrivano al runner con la run.
    const saved = await api('PUT', '/api/settings', { projectsDir: 'progetti' });
    expect(saved).toMatchObject({ status: 200, body: { projectsDir: 'progetti' } });
    const { body } = await api<RunSummary>('POST', '/api/runs', {
      workflow: 'demo',
      request: 'x',
      mode: 'headless',
      inputs: { nome: 'Ada' },
    });
    const [server, ws] = linkPair();
    app.jeko.hub.attachRunner(server);
    const acks: number[] = [];
    let started: unknown = null;
    ws.on('message', (d) => {
      const m = JSON.parse(String(d)) as { type: string; seq?: number };
      if (m.type === 'run.ack') acks.push(m.seq!);
      if (m.type === 'run.start') started = m;
    });
    await new Promise<void>((r) => ws.on('open', r));
    const send = (m: object) => ws.send(JSON.stringify(m));
    send({ type: 'hello', runnerId: 'finto', version: '0', activeRuns: [] });
    send({ type: 'ready' });
    await until(async () => started);
    expect(started).toMatchObject({ settings: { projectsDir: 'progetti' } });

    const event = { runId: body.id, type: 'step.skipped', stepId: 'lavoro' };
    send({ type: 'run.event', seq: 1, event });
    send({ type: 'run.event', seq: 1, event });
    await until(async () => acks.length === 2);
    expect(acks).toEqual([1, 1]);
    expect((await detail(body.id)).events).toHaveLength(1);
    ws.close();
  });

  it('un avvio che il runner non accetta fa fallire la run invece di lasciarla in corso', async () => {
    const [server, runner] = linkPair();
    const sent: { type: string; event?: { type: string; status?: string; error?: string } }[] = [];
    server.on('message', (d) => sent.push(JSON.parse(String(d))));
    others.push(
      new RunnerClient({
        dataDir: mkdtempSync(join(tmpdir(), 'jeko-runner-')),
        connect: () => runner,
        runnerId: 'finto',
        version: '0',
        reconnectMs: 50,
        log: { info: () => {}, warn: () => {}, error: () => {} },
      }),
    );
    others.at(-1)!.start();
    await until(async () => sent.some((m) => m.type === 'hello'));
    // Opzioni con un campo che questo runner non conosce (es. da una versione più nuova).
    server.send(
      JSON.stringify({ type: 'run.start', runId: 'r1', settings: { nuovo: 1 }, request: 'x' }),
    );
    const done = await until(async () => sent.find((m) => m.event?.type === 'run.finished'));
    expect(done.event).toMatchObject({ status: 'failed' });
    expect(done.event?.error).toMatch(/Avvio non valido/);
  });

  it('dopo un riavvio del runner la run riparte dallo stato salvato', async () => {
    startRunner();
    const { body } = await api<RunSummary>('POST', '/api/runs', {
      workflow: 'demo',
      request: 'x',
      mode: 'checkpoint',
    });
    await pendingPrompt(body.id);

    // Il runner esce senza annullare nulla; uno nuovo riparte con la stessa cartella dati.
    const old = client!;
    old.detach();
    others.push(old);
    startRunner();

    const ask = await until(async () => {
      const d = await detail(body.id);
      return (
        d.prompts.some((p) => p.status === 'superseded') &&
        d.prompts.find((p) => p.status === 'pending')
      );
    });
    await answer(body.id, ask, { kind: 'ask', value: 'Eva' });
    const gate = await until(async () =>
      (await detail(body.id)).prompts.find(
        (p) => p.status === 'pending' && p.prompt.kind === 'approve',
      ),
    );
    await answer(body.id, gate, { kind: 'approve', approved: true });
    await until(async () => (await detail(body.id)).status === 'done');
    expect(agentCalls.map((c) => c.instructions)).toEqual(['Ciao Eva']);
  });
});
