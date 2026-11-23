/**
 * Relay di Jeko: ponte tra il Jeko di casa e i dispositivi remoti (browser).
 *
 * Non legge niente: i messaggi sono cifrati da un capo all'altro (vedi
 * `packages/server/src/remote/seal.ts`) e il relay li smista per canale e dispositivo.
 * Tiene in memoria solo l'ultimo stato di ogni dispositivo (cifrato), così la pagina mostra
 * qualcosa anche a Jeko spento.
 *
 *   /ws/host?c=<canale>                Jeko (uno per canale); primo messaggio { relay: 'auth', token }
 *   /ws/client?c=<canale>&d=<disp.>    un dispositivo
 *   /                                  la pagina remota (public/)
 *
 * Messaggi: `{ d, m, s? }` (m cifrato, s = stato da tenere) e di controllo `{ relay: … }`.
 * Il canale è di chi lo usa per primo (token salvato come hash in `channels.json`); con
 * `RELAY_SECRET` impostato, solo chi lo conosce può aprirne di nuovi.
 *
 * Da solo: `node src/main.ts`; oppure dentro a Jeko (Opzioni → Accesso remoto → relay su questo PC).
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import type { WebSocket } from 'ws';

const ID = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_PAYLOAD = 1024 * 1024;
const MAX_CLIENTS = 20;
const AUTH_TIMEOUT_MS = 5000;
/** Messaggi al secondo concessi a un dispositivo (in media, con un margine). */
const CLIENT_RATE = { burst: 30, perSecond: 3 };

const PUBLIC: Record<string, string> = {
  '/': 'index.html',
  '/app.js': 'app.js',
  '/seal.js': 'seal.js',
  '/style.css': 'style.css',
  '/fonts/lato-400.woff2': 'fonts/lato-400.woff2',
  '/fonts/lato-700.woff2': 'fonts/lato-700.woff2',
  '/fonts/plex-mono-400.woff2': 'fonts/plex-mono-400.woff2',
  '/fonts/plex-mono-600.woff2': 'fonts/plex-mono-600.woff2',
};
const TYPES: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  woff2: 'font/woff2',
};

interface Channel {
  host: WebSocket | null;
  clients: Map<WebSocket, string>;
  /** Ultimo stato cifrato per dispositivo. */
  cache: Map<string, string>;
}

export interface RelayOptions {
  dataDir: string;
  secret?: string | undefined;
  publicDir?: string;
  logger?: boolean;
}

export async function buildRelay({
  dataDir,
  secret,
  publicDir = join(import.meta.dirname, '..', 'public'),
  logger = false,
}: RelayOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger });
  await app.register(websocket, { options: { maxPayload: MAX_PAYLOAD } });

  const channelsFile = join(dataDir, 'channels.json');
  const owners: Record<string, string> = existsSync(channelsFile)
    ? (JSON.parse(readFileSync(channelsFile, 'utf8')) as Record<string, string>)
    : {};
  const saveOwners = () => {
    mkdirSync(dataDir, { recursive: true });
    writeFileSync(`${channelsFile}.tmp`, JSON.stringify(owners, null, 2));
    renameSync(`${channelsFile}.tmp`, channelsFile);
  };

  const channels = new Map<string, Channel>();
  const channel = (c: string): Channel => {
    let ch = channels.get(c);
    if (!ch) channels.set(c, (ch = { host: null, clients: new Map(), cache: new Map() }));
    return ch;
  };
  const send = (s: WebSocket | null, msg: unknown) => {
    if (s && s.readyState === s.OPEN) s.send(JSON.stringify(msg));
  };
  const parse = (data: unknown): Record<string, unknown> | null => {
    try {
      const v: unknown = JSON.parse(String(data));
      return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  const hash = (token: string) => createHash('sha256').update(token).digest('hex');
  const same = (a: string, b: string) =>
    a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

  /** Il token apre il canale: quello già registrato, o uno nuovo (se il segreto torna). */
  const authorize = (c: string, token: unknown, given: unknown): boolean => {
    if (typeof token !== 'string' || token.length < 32 || token.length > 128) return false;
    const owner = owners[c];
    if (owner) return same(owner, hash(token));
    if (secret && (typeof given !== 'string' || !same(hash(given), hash(secret)))) return false;
    owners[c] = hash(token);
    saveOwners();
    return true;
  };

  app.get('/health', async () => ({ status: 'ok', app: 'jeko-relay' }));

  for (const [route, file] of Object.entries(PUBLIC)) {
    app.get(route, async (_req, reply) => {
      const ext = file.split('.').pop()!;
      return reply
        .header('content-type', TYPES[ext]!)
        .header(
          'cache-control',
          ext === 'woff2' ? 'public, max-age=31536000, immutable' : 'no-cache',
        )
        .header('referrer-policy', 'no-referrer')
        .header(
          'content-security-policy',
          "default-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
        )
        .send(readFileSync(join(publicDir, file)));
    });
  }

  app.get<{ Querystring: { c?: string } }>('/ws/host', { websocket: true }, (socket, req) => {
    const c = req.query.c;
    if (!c || !ID.test(c)) return socket.close(4400, 'canale');
    let ch: Channel | null = null;
    const timer = setTimeout(() => socket.close(4401, 'auth'), AUTH_TIMEOUT_MS);

    socket.on('message', (data) => {
      const msg = parse(data);
      if (!msg) return;
      if (!ch) {
        if (msg['relay'] !== 'auth' || !authorize(c, msg['token'], msg['secret']))
          return socket.close(4401, 'auth');
        clearTimeout(timer);
        ch = channel(c);
        if (ch.host) ch.host.close(4409, 'sostituito');
        ch.host = socket;
        send(socket, { relay: 'ok', clients: [...new Set(ch.clients.values())] });
        for (const client of ch.clients.keys()) send(client, { relay: 'host', online: true });
        return;
      }
      const d = msg['d'];
      if (typeof d !== 'string' || !ID.test(d)) return;
      if (msg['relay'] === 'drop') {
        ch.cache.delete(d);
        for (const [client, id] of ch.clients) if (id === d) client.close(4403, 'revocato');
        return;
      }
      if (typeof msg['m'] !== 'string') return;
      const frame = JSON.stringify({ m: msg['m'], ...(msg['s'] === true && { s: true }) });
      if (msg['s'] === true) ch.cache.set(d, frame);
      for (const [client, id] of ch.clients)
        if (id === d && client.readyState === client.OPEN) client.send(frame);
    });
    socket.on('close', () => {
      clearTimeout(timer);
      if (!ch || ch.host !== socket) return;
      ch.host = null;
      for (const client of ch.clients.keys()) send(client, { relay: 'host', online: false });
    });
  });

  app.get<{ Querystring: { c?: string; d?: string } }>(
    '/ws/client',
    { websocket: true },
    (socket, req) => {
      const { c, d } = req.query;
      if (!c || !d || !ID.test(c) || !ID.test(d)) return socket.close(4400, 'canale');
      const ch = channel(c);
      if (ch.clients.size >= MAX_CLIENTS) return socket.close(4429, 'troppi');
      ch.clients.set(socket, d);
      send(socket, { relay: 'host', online: ch.host !== null });
      const cached = ch.cache.get(d);
      if (cached) socket.send(cached);
      send(ch.host, { relay: 'client', d, online: true });

      let tokens = CLIENT_RATE.burst;
      let last = Date.now();
      socket.on('message', (data) => {
        const now = Date.now();
        tokens = Math.min(
          CLIENT_RATE.burst,
          tokens + ((now - last) / 1000) * CLIENT_RATE.perSecond,
        );
        last = now;
        if (tokens < 1) return;
        tokens -= 1;
        const msg = parse(data);
        if (!msg || typeof msg['m'] !== 'string') return;
        if (!ch.host) return send(socket, { relay: 'host', online: false });
        send(ch.host, { d, m: msg['m'] });
      });
      socket.on('close', () => {
        ch.clients.delete(socket);
        send(ch.host, { relay: 'client', d, online: false });
        if (!ch.host && ch.clients.size === 0 && ch.cache.size === 0) channels.delete(c);
      });
    },
  );

  return app;
}
