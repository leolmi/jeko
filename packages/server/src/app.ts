import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { HealthSchema } from '@jeko/shared';
import type { Db } from './db/db.js';
import { ProjectStore } from './projects/store.js';
import { projectRoutes } from './routes/projects.js';
import { runnerRoutes } from './routes/runner.js';
import { runRoutes } from './routes/runs.js';
import { settingsRoutes } from './routes/settings.js';
import { setupRoutes } from './routes/setup.js';
import { workflowRoutes } from './routes/workflows.js';
import { RunnerHub } from './runs/hub.js';
import { RunStore } from './runs/store.js';
import { bearer, RunnerTokens } from './runner/token.js';
import { UserSettingsStore } from './settings/store.js';
import { WorkflowStore } from './workflows/store.js';

export interface AppOptions {
  db: Db;
  logger?: boolean;
  /** Bundle del runner per l'installer (di default `packages/runner/dist`). */
  runnerDist?: string;
  /** Indirizzo del server per il runner installato. */
  serverUrl?: string;
}

const VERSION = '0.1.0';

export async function buildApp({
  db,
  logger = false,
  runnerDist = fileURLToPath(new URL('../../runner/dist/', import.meta.url)),
  serverUrl = 'http://127.0.0.1:4310',
}: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger }).withTypeProvider<TypeBoxTypeProvider>();

  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  await app.register(websocket);

  const workflows = new WorkflowStore(db);
  const runs = new RunStore(db);
  const settings = new UserSettingsStore(db);
  const projects = new ProjectStore(db);
  const hub = new RunnerHub(runs, workflows, settings, projects, app.log);
  const tokens = new RunnerTokens(db);

  app.get('/api/health', { schema: { response: { 200: HealthSchema } } }, async () => ({
    status: 'ok' as const,
    version: VERSION,
    runner: hub.connected,
  }));

  await app.register(projectRoutes, { projects, hub });
  await app.register(workflowRoutes, { workflows, hub });
  await app.register(runRoutes, { runs, workflows, hub });
  await app.register(setupRoutes, { db, hub, tokens, version: VERSION });
  await app.register(runnerRoutes, { tokens, runnerDist, serverUrl });
  await app.register(settingsRoutes, { settings });

  // Il runner si presenta con il suo token. Un browser (che manda sempre Origin) non entra mai:
  // una pagina web aperta sul PC non può fingersi runner.
  app.get(
    '/ws/runner',
    {
      websocket: true,
      preValidation: async (req, reply) => {
        const ok =
          req.headers.origin === undefined &&
          (await tokens.verify(bearer(req.headers.authorization)));
        if (!ok) return reply.code(401).send({ message: 'Token del runner non valido' });
      },
    },
    (socket) => hub.attachRunner(socket),
  );
  app.get('/ws/admin', { websocket: true }, (socket) => hub.attachAdmin(socket));

  app.addHook('onClose', () => db.close());
  return app;
}
