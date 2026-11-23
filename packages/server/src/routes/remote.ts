import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { RemoteConfigSchema, type RemoteInfo } from '@jeko/shared';
import { Type } from '@sinclair/typebox';
import type { RunnerHub } from '../runs/hub.js';
import type { RemoteLink } from '../remote/link.js';
import type { LocalRelay } from '../remote/local-relay.js';
import type { RemoteStore } from '../remote/store.js';

const DeviceParams = Type.Object({ id: Type.String({ pattern: '^[A-Za-z0-9_-]{8,64}$' }) });

/** Accesso remoto (solo dalla web-app sul PC: i dispositivi remoti non arrivano qui). */
export const remoteRoutes: FastifyPluginAsyncTypebox<{
  store: RemoteStore;
  link: RemoteLink;
  relay: LocalRelay;
  hub: RunnerHub;
}> = async (app, { store, link, relay, hub }) => {
  const info = (): RemoteInfo => {
    const online = new Set(link.onlineDevices);
    return {
      enabled: store.enabled,
      relayUrl: store.relayUrl,
      hasSecret: store.ownSecret !== '',
      localRelay: store.localRelay,
      localRelayError: relay.error,
      status: link.status,
      devices: store.publicDevices().map((d) => ({ ...d, online: online.has(d.id) })),
    };
  };

  app.get('/api/remote', async () => info());

  app.put('/api/remote', { schema: { body: RemoteConfigSchema } }, async (req, reply) => {
    if (req.body.enabled && !req.body.relayUrl)
      return reply.code(400).send({ message: 'Indirizzo del relay mancante' });
    store.configure(req.body.enabled, req.body.relayUrl, req.body.secret, req.body.localRelay);
    await relay.sync();
    link.start();
    return info();
  });

  // Nuovo dispositivo: il link (con la chiave) si mostra una volta sola, nel QR.
  app.post('/api/remote/devices', async (_req, reply) => {
    if (!store.enabled) return reply.code(409).send({ message: 'Accesso remoto spento' });
    const device = store.pair();
    hub.remoteChanged();
    return reply.code(201).send({ id: device.id, link: store.link(device) });
  });

  app.post(
    '/api/remote/devices/:id/confirm',
    { schema: { params: DeviceParams } },
    async (req, reply) => {
      const device = store.device(req.params.id);
      if (!device) return reply.callNotFound();
      if (!device.seenAt) return reply.code(409).send({ message: 'Dispositivo mai collegato' });
      store.update(device.id, { confirmed: true });
      hub.remoteChanged();
      await link.confirmed(device.id);
      return info();
    },
  );

  app.delete(
    '/api/remote/devices/:id',
    { schema: { params: DeviceParams } },
    async (req, reply) => {
      if (!store.remove(req.params.id)) return reply.callNotFound();
      link.drop(req.params.id);
      hub.remoteChanged();
      return info();
    },
  );
};
