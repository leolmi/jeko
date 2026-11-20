import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { buildApp } from '../app.js';
import type { Db } from '../db/db.js';
import { migrate } from '../db/migrate.js';

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

/** Esito di una connessione del runner: 'open' o il codice HTTP del rifiuto. */
function connect(url: string, headers: Record<string, string> = {}): Promise<'open' | number> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, { headers });
    ws.on('open', () => {
      ws.close();
      resolve('open');
    });
    ws.on('unexpected-response', (_req, res) => {
      resolve(res.statusCode ?? 0);
      ws.terminate();
    });
    ws.on('error', () => {});
  });
}

describe('token e installer del runner', () => {
  let app: FastifyInstance;
  let ws: string;

  beforeEach(async () => {
    const db = pgliteDb();
    await migrate(db);
    const dist = mkdtempSync(join(tmpdir(), 'jeko-dist-'));
    writeFileSync(join(dist, 'runner.js'), 'console.log("runner")');
    app = await buildApp({ db, runnerDist: dist, serverUrl: 'http://127.0.0.1:4310' });
    const addr = await app.listen({ host: '127.0.0.1', port: 0 });
    ws = `${addr.replace('http', 'ws')}/ws/runner`;
  });

  afterEach(() => app.close());

  const installer = async () => {
    const res = await app.inject({ method: 'POST', url: '/api/runner/installer', payload: {} });
    expect(res.statusCode).toBe(200);
    const token = /\$Token = '([^']+)'/.exec(res.body)?.[1];
    expect(token).toBeTruthy();
    return { body: res.body, token: token! };
  };

  it('senza token creato accetta il runner, ma mai da un browser', async () => {
    expect((await app.inject('/api/setup')).json().runner.token).toBe(false);
    expect(await connect(ws)).toBe('open');
    expect(await connect(ws, { origin: 'http://evil.example' })).toBe(401);
  });

  it("dopo l'installer serve il token, e solo l'ultimo vale", async () => {
    const first = await installer();
    expect(first.body).toContain("$Server = 'http://127.0.0.1:4310'");
    expect(first.body.charCodeAt(0)).toBe(0xfeff);
    expect((await app.inject('/api/setup')).json().runner.token).toBe(true);

    expect(await connect(ws)).toBe(401);
    expect(await connect(ws, { authorization: `Bearer ${first.token}` })).toBe('open');

    const second = await installer();
    expect(second.token).not.toBe(first.token);
    expect(await connect(ws, { authorization: `Bearer ${first.token}` })).toBe(401);
    expect(await connect(ws, { authorization: `Bearer ${second.token}` })).toBe('open');
  });

  it("l'installer vuole un corpo JSON (niente form da altre pagine)", async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/runner/installer',
      headers: { 'content-type': 'text/plain' },
      payload: 'x',
    });
    expect(res.statusCode).toBe(400);
  });

  it('serve i file del runner solo con il token', async () => {
    const { token } = await installer();
    const get = (name: string, auth?: string) =>
      app.inject({
        url: `/api/runner/files/${name}`,
        ...(auth && { headers: { authorization: `Bearer ${auth}` } }),
      });
    expect((await get('runner.js')).statusCode).toBe(401);
    const ok = await get('runner.js', token);
    expect(ok.statusCode).toBe(200);
    expect(ok.body).toContain('runner');
    expect((await get('mcp.js', token)).statusCode).toBe(404); // non compilato
    expect((await get('..%2Fsecret', token)).statusCode).toBe(404);
  });
});
