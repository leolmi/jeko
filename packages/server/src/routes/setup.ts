import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { SetupStatus } from '@jeko/shared';
import type { SettingsFile } from '../data/files.js';
import type { RunnerHub } from '../runs/hub.js';
import type { WorkflowStore } from '../workflows/store.js';

const COMPLETED = 'setup.completed';

/** Primo avvio: stato del servizio, dei dati, del runner e verifiche dell'ambiente. */
export const setupRoutes: FastifyPluginAsyncTypebox<{
  settings: SettingsFile;
  workflows: WorkflowStore;
  hub: RunnerHub;
  version: string;
}> = async (app, { settings, workflows, hub, version }) => {
  app.get('/api/setup', async (): Promise<SetupStatus> => ({
    completed: settings.get(COMPLETED) === true,
    server: { version, workflows: workflows.count },
    runner: hub.runnerInfo,
  }));

  app.post('/api/setup/checks', async (_req, reply) => {
    if (!hub.requestChecks()) return reply.code(409).send({ message: 'Runner non collegato' });
    return reply.code(202).send();
  });

  app.post('/api/setup/complete', async (_req, reply) => {
    settings.set(COMPLETED, true);
    return reply.code(204).send();
  });

  /** Per rifare il primo avvio. */
  app.delete('/api/setup/complete', async (_req, reply) => {
    settings.delete(COMPLETED);
    return reply.code(204).send();
  });
};
