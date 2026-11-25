import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { UserSettingsSchema } from '@jeko/shared';
import type { RunnerHub } from '../runs/hub.js';
import type { UserSettingsStore } from '../settings/store.js';

/** Opzioni dell'utente, lette e salvate dalla web-app. */
export const settingsRoutes: FastifyPluginAsyncTypebox<{
  settings: UserSettingsStore;
  hub?: RunnerHub;
}> = async (app, { settings, hub }) => {
  app.get('/api/settings', { schema: { response: { 200: UserSettingsSchema } } }, () =>
    settings.get(),
  );

  app.put(
    '/api/settings',
    { schema: { body: UserSettingsSchema, response: { 200: UserSettingsSchema } } },
    async (req) => {
      const saved = await settings.set(req.body);
      await hub?.sendAgentsConfig();
      return saved;
    },
  );
};
