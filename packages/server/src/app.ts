import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { CreateProjectSchema, HealthSchema, ProjectSchema, type Project } from '@jeko/shared';
import { Type } from '@sinclair/typebox';
import type { Db } from './db/db.js';
import { runRoutes } from './routes/runs.js';
import { setupRoutes } from './routes/setup.js';
import { workflowRoutes } from './routes/workflows.js';
import { RunnerHub } from './runs/hub.js';
import { RunStore } from './runs/store.js';
import { WorkflowStore } from './workflows/store.js';

export interface AppOptions {
  db: Db;
  logger?: boolean;
}

const VERSION = '0.1.0';

const PROJECT_COLUMNS = `id, name,
  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt"`;

export async function buildApp({ db, logger = false }: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger }).withTypeProvider<TypeBoxTypeProvider>();

  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  await app.register(websocket);

  const workflows = new WorkflowStore(db);
  const runs = new RunStore(db);
  const hub = new RunnerHub(runs, workflows, app.log);

  app.get('/api/health', { schema: { response: { 200: HealthSchema } } }, async () => ({
    status: 'ok' as const,
    version: VERSION,
    runner: hub.connected,
  }));

  app.get(
    '/api/projects',
    { schema: { response: { 200: Type.Array(ProjectSchema) } } },
    async () => {
      const { rows } = await db.query<Project>(
        `SELECT ${PROJECT_COLUMNS} FROM projects ORDER BY created_at`,
      );
      return rows;
    },
  );

  app.post(
    '/api/projects',
    { schema: { body: CreateProjectSchema, response: { 201: ProjectSchema } } },
    async (req, reply) => {
      const { rows } = await db.query<Project>(
        `INSERT INTO projects (name) VALUES ($1) RETURNING ${PROJECT_COLUMNS}`,
        [req.body.name],
      );
      return reply.code(201).send(rows[0]!);
    },
  );

  await app.register(workflowRoutes, { workflows });
  await app.register(runRoutes, { runs, workflows, hub });
  await app.register(setupRoutes, { db, hub, version: VERSION });

  app.get('/ws/runner', { websocket: true }, (socket) => hub.attachRunner(socket));
  app.get('/ws/admin', { websocket: true }, (socket) => hub.attachAdmin(socket));

  app.addHook('onClose', () => db.close());
  return app;
}
