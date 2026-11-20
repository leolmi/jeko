import { PGlite } from '@electric-sql/pglite';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import WebSocket from 'ws';
import type { AdminMessage, PromptRecord, RunDetail, RunSummary } from '@jeko/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../packages/server/src/app.js';
import type { Db } from '../../packages/server/src/db/db.js';
import { migrate } from '../../packages/server/src/db/migrate.js';
import { RunnerClient } from '../../packages/runner/src/client.js';
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

function pgliteDb(): Db {
  const pg = new PGlite();
  return {
    query: async <R>(sql: string, params?: unknown[]) => ({
      rows: (await pg.query<R>(sql, params)).rows,
    }),
    close: () => pg.close(),
  };
}

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
  let app: FastifyInstance;
  let base: string;
  let client: RunnerClient | undefined;
  let others: RunnerClient[];
  let dataDir: string;
  let agentCalls: AgentRequest[];

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
      url: `${base.replace('http', 'ws')}/ws/runner`,
      runnerId: 'test-pc',
      version: '0.0.0',
      reconnectMs: 50,
      log: { info: () => {}, warn: () => {}, error: () => {} },
      makeHost: (io): Host => ({
        ...io,
        functions: {},
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
    others = [];
    dataDir = mkdtempSync(join(tmpdir(), 'jeko-e2e-'));
    const db = pgliteDb();
    await migrate(db);
    app = await buildApp({ db });
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

  it('sopravvive a una disconnessione del runner mentre attende', async () => {
    startRunner();
    const { body } = await api<RunSummary>('POST', '/api/runs', {
      workflow: 'demo',
      request: 'x',
      mode: 'checkpoint',
    });
    const ask = await pendingPrompt(body.id);

    // Il server chiude le connessioni dei runner: il client si ricollega da solo.
    for (const c of app.websocketServer.clients) c.terminate();
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
    const { body } = await api<RunSummary>('POST', '/api/runs', {
      workflow: 'demo',
      request: 'x',
      mode: 'headless',
      inputs: { nome: 'Ada' },
    });
    const ws = new WebSocket(`${base.replace('http', 'ws')}/ws/runner`);
    const acks: number[] = [];
    let started = false;
    ws.on('message', (d) => {
      const m = JSON.parse(String(d)) as { type: string; seq?: number };
      if (m.type === 'run.ack') acks.push(m.seq!);
      if (m.type === 'run.start') started = true;
    });
    await new Promise((r) => ws.once('open', r));
    const send = (m: object) => ws.send(JSON.stringify(m));
    send({ type: 'hello', runnerId: 'finto', version: '0', activeRuns: [] });
    send({ type: 'ready' });
    await until(async () => started);

    const event = { runId: body.id, type: 'step.skipped', stepId: 'lavoro' };
    send({ type: 'run.event', seq: 1, event });
    send({ type: 'run.event', seq: 1, event });
    await until(async () => acks.length === 2);
    expect(acks).toEqual([1, 1]);
    expect((await detail(body.id)).events).toHaveLength(1);
    ws.close();
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
