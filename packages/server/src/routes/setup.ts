import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { SetupStatus } from '@jeko/shared';
import type { Db } from '../db/db.js';
import type { RunnerHub } from '../runs/hub.js';

const COMPLETED = 'setup.completed';

/** Primo avvio: stato di server, database, runner e verifiche dell'ambiente. */
export const setupRoutes: FastifyPluginAsyncTypebox<{
  db: Db;
  hub: RunnerHub;
  version: string;
}> = async (app, { db, hub, version }) => {
  app.get('/api/setup', async (): Promise<SetupStatus> => {
    let database = true;
    let workflows = 0;
    let completed = false;
    try {
      const w = await db.query<{ n: number }>(
        `SELECT count(DISTINCT name)::int AS n FROM workflows`,
      );
      workflows = w.rows[0]?.n ?? 0;
      const s = await db.query<{ value: boolean }>(`SELECT value FROM settings WHERE key = $1`, [
        COMPLETED,
      ]);
      completed = s.rows[0]?.value === true;
    } catch {
      database = false;
    }
    return { completed, server: { version, database, workflows }, runner: hub.runnerInfo };
  });

  app.post('/api/setup/checks', async (_req, reply) => {
    if (!hub.requestChecks()) return reply.code(409).send({ message: 'Runner non collegato' });
    return reply.code(202).send();
  });

  app.post('/api/setup/complete', async (_req, reply) => {
    await db.query(
      `INSERT INTO settings (key, value) VALUES ($1, 'true'::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [COMPLETED],
    );
    return reply.code(204).send();
  });

  /** Per rifare il primo avvio. */
  app.delete('/api/setup/complete', async (_req, reply) => {
    await db.query(`DELETE FROM settings WHERE key = $1`, [COMPLETED]);
    return reply.code(204).send();
  });
};
