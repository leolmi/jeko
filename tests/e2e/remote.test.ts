import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import type { Project, RemoteInfo } from '@jeko/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type JekoApp } from '../../packages/server/src/app.js';
import * as node from '../../packages/server/src/remote/seal.js';
import { buildRelay } from '../../packages/relay/src/relay.js';
// La stessa cifratura della pagina remota (gira anche in Node: WebCrypto, atob/btoa).
import * as page from '../../packages/relay/public/seal.js';

async function until<T>(fn: () => T | undefined | null | false, ms = 5000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('cifratura', () => {
  it('pagina e servizio si capiscono, nelle due direzioni', async () => {
    const k = node.newKey();
    const [a, b] = [await node.importKey(k), await page.importKey(k)];
    const fromHost = await node.seal(a, 'h2c', 'dev12345', { x: 1 });
    expect((await page.open(b, 'h2c', 'dev12345', fromHost))?.body).toEqual({ x: 1 });
    const fromPage = await page.seal(b, 'c2h', 'dev12345', { y: 'è' });
    expect((await node.open(a, 'c2h', 'dev12345', fromPage))?.body).toEqual({ y: 'è' });
  });

  it('un messaggio non vale per un altro dispositivo, direzione o chiave', async () => {
    const a = await node.importKey(node.newKey());
    const m = await node.seal(a, 'c2h', 'dev12345', 1);
    expect(await node.open(a, 'h2c', 'dev12345', m)).toBeNull();
    expect(await node.open(a, 'c2h', 'altro123', m)).toBeNull();
    expect(await node.open(await node.importKey(node.newKey()), 'c2h', 'dev12345', m)).toBeNull();
  });
});

describe('accesso remoto: Jeko ↔ relay ↔ dispositivo', () => {
  let relay: FastifyInstance;
  let relayUrl: string;
  let app: JekoApp;
  let project: Project;
  let sockets: WebSocket[];

  const api = async <T>(method: string, url: string, body?: unknown) => {
    const res = await app.inject({
      method: method as 'GET',
      url,
      ...(body !== undefined && { payload: body as object }),
    });
    return { status: res.statusCode, body: (res.body ? res.json() : undefined) as T };
  };

  /** Dispositivo finto: come la pagina, con la sua chiave. */
  async function device(link: string) {
    const hash = new URLSearchParams(new URL(link).hash.slice(1));
    const [c, d, k] = [hash.get('c')!, hash.get('d')!, hash.get('k')!];
    const key = await page.importKey(k);
    const ws = new WebSocket(`${relayUrl.replace('http', 'ws')}/ws/client?c=${c}&d=${d}`);
    sockets.push(ws);
    const inbox: Record<string, unknown>[] = [];
    let closed: number | null = null;
    ws.onmessage = async (e) => {
      const msg = JSON.parse(String(e.data)) as { m?: string; relay?: string };
      if (msg.relay) return inbox.push(msg);
      const opened = await page.open(key, 'h2c', d, msg.m!);
      if (opened) inbox.push(opened.body as Record<string, unknown>);
    };
    ws.onclose = (e) => (closed = e.code);
    await until(() => ws.readyState === WebSocket.OPEN);
    let seq = 0;
    const sendRaw = (m: string) => ws.send(JSON.stringify({ m }));
    const send = async (body: unknown) => {
      const m = await page.seal(key, 'c2h', d, body);
      sendRaw(m);
      return m;
    };
    const req = async (method: string, path: string, body?: unknown) => {
      const id = `r${++seq}`;
      await send({ t: 'req', id, method, path, ...(body !== undefined && { body }) });
      return until(() => inbox.find((m) => m['t'] === 'res' && m['id'] === id)) as Promise<{
        status: number;
        body: unknown;
      }>;
    };
    return { id: d, inbox, send, sendRaw, req, closed: () => closed };
  }

  /** Il servizio ha ricevuto il saluto del dispositivo. */
  const seen = async (id: string) => {
    for (let i = 0; i < 250; i++) {
      const info = (await api<RemoteInfo>('GET', '/api/remote')).body;
      if (info.devices.find((d) => d.id === id)?.seenAt) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error('timeout');
  };

  beforeEach(async () => {
    sockets = [];
    relay = await buildRelay({ dataDir: mkdtempSync(join(tmpdir(), 'jeko-relay-')) });
    await relay.listen({ host: '127.0.0.1', port: 0 });
    relayUrl = `http://127.0.0.1:${(relay.server.address() as AddressInfo).port}`;
    app = await buildApp({ dataDir: mkdtempSync(join(tmpdir(), 'jeko-remote-')) });
    project = (
      await api<Project>('POST', '/api/projects', {
        name: 'Demo',
        path: mkdtempSync(join(tmpdir(), 'jeko-prj-')),
      })
    ).body;
    const put = await api<RemoteInfo>('PUT', '/api/remote', { enabled: true, relayUrl });
    expect(put.status).toBe(200);
    await until(() => app.jeko.remote.status === 'online');
  });

  afterEach(async () => {
    for (const s of sockets) s.close();
    await app.close();
    await relay.close();
  });

  it('collega, conferma, risponde solo alle richieste ammesse e revoca', async () => {
    const pair = await api<{ id: string; link: string }>('POST', '/api/remote/devices');
    expect(pair.status).toBe(201);
    expect(pair.body.link.startsWith(`${relayUrl}/#`)).toBe(true);

    const dev = await device(pair.body.link);
    await dev.send({ t: 'hello', name: 'Telefono' });
    await until(() => dev.inbox.find((m) => m['t'] === 'state' && m['confirmed'] === false));
    await seen(dev.id);

    // Prima della conferma sul PC: niente dati.
    expect((await dev.req('GET', '/api/projects')).status).toBe(403);

    const info = (await api<RemoteInfo>('GET', '/api/remote')).body;
    expect(info.devices[0]).toMatchObject({ name: 'Telefono', confirmed: false, online: true });
    expect(JSON.stringify(info)).not.toContain(new URL(pair.body.link).hash.slice(1));
    await api('POST', `/api/remote/devices/${dev.id}/confirm`);

    const state = await until(
      () =>
        dev.inbox.find((m) => m['t'] === 'state' && m['confirmed'] === true) as
          { projects: Project[] } | undefined,
    );
    expect(state.projects.map((p) => p.name)).toEqual(['Demo']);

    expect((await dev.req('GET', '/api/projects')).status).toBe(200);
    expect((await dev.req('GET', '/api/settings')).status).toBe(403);
    expect((await dev.req('PUT', '/api/remote', { enabled: false, relayUrl: '' })).status).toBe(
      403,
    );
    const outside = await dev.req('POST', '/api/runs', {
      request: 'x',
      mode: 'headless',
      direct: true,
      cwd: tmpdir(),
    });
    expect(outside.status).toBe(400);
    const started = await dev.req('POST', '/api/runs', {
      request: 'Ciao',
      mode: 'headless',
      direct: true,
      cwd: project.path,
      agent: { model: 'claude-opus-5-5', effort: 'high' },
    });
    expect(started.status).toBe(201);
    // Il dettaglio dice con che modello e impegno lavora il task.
    const detail = await dev.req('GET', `/api/runs/${(started.body as { id: string }).id}`);
    expect(detail.body).toMatchObject({ model: 'claude-opus-5-5', effort: 'high', session: false });

    // Lo stesso messaggio rimandato non si esegue due volte.
    const m = await page.seal(
      await page.importKey(new URLSearchParams(new URL(pair.body.link).hash.slice(1)).get('k')!),
      'c2h',
      dev.id,
      { t: 'req', id: 'dup', method: 'GET', path: '/api/runs' },
    );
    dev.sendRaw(m);
    dev.sendRaw(m);
    await until(() => dev.inbox.some((x) => x['id'] === 'dup'));
    await new Promise((r) => setTimeout(r, 200));
    expect(dev.inbox.filter((x) => x['id'] === 'dup')).toHaveLength(1);

    await api('DELETE', `/api/remote/devices/${dev.id}`);
    expect(await until(() => dev.closed())).toBe(4403);
  });

  it('il relay tiene lo stato cifrato per chi si collega a Jeko spento', async () => {
    const pair = await api<{ id: string; link: string }>('POST', '/api/remote/devices');
    const first = await device(pair.body.link);
    await first.send({ t: 'hello', name: 'Telefono' });
    await seen(first.id);
    expect((await api('POST', `/api/remote/devices/${first.id}/confirm`)).status).toBe(200);
    await until(() => first.inbox.find((m) => m['confirmed'] === true));

    app.jeko.remote.stop();
    const later = await device(pair.body.link);
    await until(() => later.inbox.find((m) => m['relay'] === 'host' && m['online'] === false));
    const cached = await until(() =>
      later.inbox.find((m) => m['t'] === 'state' && m['confirmed'] === true),
    );
    expect(cached).toBeTruthy();
  });

  it('un altro Jeko non può prendersi il canale', async () => {
    const info = (await api<RemoteInfo>('GET', '/api/remote')).body;
    expect(info.status).toBe('online');
    const ws = new WebSocket(
      `${relayUrl.replace('http', 'ws')}/ws/host?c=${
        // Il canale è nel link di un dispositivo.
        new URLSearchParams(
          new URL(
            (await api<{ link: string }>('POST', '/api/remote/devices')).body.link,
          ).hash.slice(1),
        ).get('c')
      }`,
    );
    sockets.push(ws);
    let code = 0;
    ws.onclose = (e) => (code = e.code);
    ws.onopen = () => ws.send(JSON.stringify({ relay: 'auth', token: 'x'.repeat(40) }));
    expect(await until(() => code)).toBe(4401);
  });
});

describe('relay con segreto (RELAY_SECRET)', () => {
  it('apre il canale solo con il segreto, che non torna indietro', async () => {
    const relay = await buildRelay({
      dataDir: mkdtempSync(join(tmpdir(), 'jeko-relay-')),
      secret: 'segreto-del-relay',
    });
    await relay.listen({ host: '127.0.0.1', port: 0 });
    const relayUrl = `http://127.0.0.1:${(relay.server.address() as AddressInfo).port}`;
    const app = await buildApp({ dataDir: mkdtempSync(join(tmpdir(), 'jeko-remote-')) });
    const put = async (body: object) =>
      (await app.inject({ method: 'PUT', url: '/api/remote', payload: body })).json<RemoteInfo>();
    try {
      expect((await put({ enabled: true, relayUrl })).hasSecret).toBe(false);
      await until(() => app.jeko.remote.status === 'rejected');

      const info = await put({ enabled: true, relayUrl, secret: 'segreto-del-relay' });
      expect(info.hasSecret).toBe(true);
      expect(JSON.stringify(info)).not.toContain('segreto-del-relay');
      await until(() => app.jeko.remote.status === 'online');

      // Senza `secret` resta quello salvato; '' lo toglie.
      expect((await put({ enabled: true, relayUrl })).hasSecret).toBe(true);
      expect((await put({ enabled: false, relayUrl, secret: '' })).hasSecret).toBe(false);
    } finally {
      await app.close();
      await relay.close();
    }
  });
});

describe('relay su questo PC', () => {
  it('Jeko avvia il relay da sé, col suo segreto, e lo spegne con l’accesso remoto', async () => {
    const app = await buildApp({
      dataDir: mkdtempSync(join(tmpdir(), 'jeko-remote-')),
      relay: { port: 0 },
    });
    const put = async (body: object) =>
      (await app.inject({ method: 'PUT', url: '/api/remote', payload: body })).json<RemoteInfo>();
    // L'indirizzo pubblico (Funnel) va nel QR; Jeko si collega al relay sul PC.
    const relayUrl = 'https://jeko.example.ts.net';
    try {
      const info = await put({ enabled: true, relayUrl, localRelay: true });
      expect(info).toMatchObject({ localRelay: true, localRelayError: null, hasSecret: false });
      await until(() => app.jeko.remote.status === 'online');
      const local = app.jeko.relay.url;
      expect((await fetch(`${local}/health`)).ok).toBe(true);
      expect((await fetch(`${local}/`)).headers.get('content-type')).toContain('text/html');
      const pair = await app.inject({ method: 'POST', url: '/api/remote/devices' });
      expect(pair.json<{ link: string }>().link.startsWith(`${relayUrl}/#`)).toBe(true);

      // Un altro Jeko senza segreto non apre canali nuovi sul relay locale.
      let code: number | null = null;
      const ws = new WebSocket(`${local.replace('http', 'ws')}/ws/host?c=altrocanale1`);
      ws.onclose = (e) => (code = e.code);
      ws.onopen = () => ws.send(JSON.stringify({ relay: 'auth', token: 'x'.repeat(40) }));
      expect(await until(() => code)).toBe(4401);

      await put({ enabled: false, relayUrl, localRelay: true });
      await expect(fetch(`${local}/health`)).rejects.toThrow();
    } finally {
      await app.close();
    }
  });
});
