import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { UserSettingsSchema } from '@jeko/shared';
import type { UserSettingsStore } from '../settings/store.js';

/** Opzioni dell'utente, lette e salvate dalla web-app. */
export const settingsRoutes: FastifyPluginAsyncTypebox<{ settings: UserSettingsStore }> = async (
  app,
  { settings },
) => {
  app.get('/api/settings', { schema: { response: { 200: UserSettingsSchema } } }, () =>
    settings.get(),
  );

  app.put(
    '/api/settings',
    { schema: { body: UserSettingsSchema, response: { 200: UserSettingsSchema } } },
    (req) => settings.set(req.body),
  );
};
