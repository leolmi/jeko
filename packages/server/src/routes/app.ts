import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import type { AppInfo, UpdateInfo } from '@jeko/shared';
import { Type } from '@sinclair/typebox';
import type { Updater } from '../desktop/updater.js';
import type { RunStore } from '../runs/store.js';

/** Comandi dell'app desktop: aggiornamenti e riavvio. */
export interface AppControl {
  updater: Updater;
  /** Chiude la finestra e il servizio, poi riapre l'app (dopo un aggiornamento). */
  restart(): void;
}

/** Versione dell'app e aggiornamenti (solo nell'app desktop). */
export const appRoutes: FastifyPluginAsyncTypebox<{
  control: AppControl | undefined;
  runs: RunStore;
  version: string;
}> = async (app, { control, runs, version }) => {
  app.get('/api/app', async (): Promise<AppInfo> => ({
    version,
    desktop: control !== undefined,
    update: control?.updater.info ?? null,
    active: runs.activeCount,
  }));

  app.post('/api/app/update/check', async (_req, reply): Promise<UpdateInfo> => {
    if (!control) return reply.code(409).send({ message: 'Solo nell’app desktop' });
    return control.updater.check();
  });

  // Corpo JSON obbligatorio: da un'altra origine il browser dovrebbe chiedere il permesso (CORS).
  app.post(
    '/api/app/update/install',
    { schema: { body: Type.Object({}, { additionalProperties: false }) } },
    async (_req, reply) => {
      if (!control) return reply.code(409).send({ message: 'Solo nell’app desktop' });
      // Il riavvio chiude il servizio: i task al lavoro si perderebbero a metà turno.
      if (runs.activeCount > 0)
        return reply.code(409).send({ message: 'Ci sono task al lavoro: aspetta che finiscano' });
      try {
        await control.updater.install();
      } catch (e) {
        return reply.code(502).send({ message: e instanceof Error ? e.message : String(e) });
      }
      setTimeout(() => control.restart(), 300);
      return reply.code(202).send();
    },
  );
};
