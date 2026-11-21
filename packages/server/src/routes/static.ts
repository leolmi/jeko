import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import type { FastifyPluginAsync } from 'fastify';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

/**
 * Web-app (build di Angular) servita dal servizio: la finestra dell'app la apre da qui, così
 * API e WebSocket sono della stessa origine. I percorsi sconosciuti danno `index.html` (rotte
 * della web-app), tranne sotto `/api` e `/ws`.
 */
export const staticRoutes: FastifyPluginAsync<{ root: string }> = async (app, { root }) => {
  const base = normalize(root + sep);
  app.get('/*', async (req, reply) => {
    const path = decodeURIComponent(req.url.split('?')[0]!);
    if (path.startsWith('/api/') || path.startsWith('/ws/')) return reply.callNotFound();
    let file = normalize(join(base, path));
    if (!file.startsWith(base)) return reply.code(404).send();
    if (!existsSync(file) || !statSync(file).isFile()) {
      if (extname(path)) return reply.code(404).send();
      file = join(base, 'index.html');
      if (!existsSync(file)) return reply.code(404).send({ message: 'Web-app non compilata' });
    }
    const html = file.endsWith('.html');
    return reply
      .header('content-type', TYPES[extname(file)] ?? 'application/octet-stream')
      .header('cache-control', html ? 'no-cache' : 'public, max-age=31536000, immutable')
      .send(createReadStream(file));
  });
};
