import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { CreateProjectSchema, Id, PickFolderSchema, ProjectSchema } from '@jeko/shared';
import { Type } from '@sinclair/typebox';
import type { ProjectStore } from '../projects/store.js';
import type { RunnerHub } from '../runs/hub.js';

/** Progetti gestiti: elenco, aggiunta di una cartella esistente, rimozione dall'elenco. */
export const projectRoutes: FastifyPluginAsyncTypebox<{
  projects: ProjectStore;
  hub: RunnerHub;
}> = async (app, { projects, hub }) => {
  app.get('/api/projects', { schema: { response: { 200: Type.Array(ProjectSchema) } } }, () =>
    projects.list(),
  );

  app.post(
    '/api/projects',
    {
      schema: {
        body: CreateProjectSchema,
        response: { 201: ProjectSchema, 409: Type.Object({ message: Type.String() }) },
      },
    },
    async (req, reply) => {
      const project = await projects.add(req.body);
      if (!project) return reply.code(409).send({ message: 'Cartella già usata da un progetto' });
      return reply.code(201).send(project);
    },
  );

  // Dialogo di scelta cartella sul PC del runner (il browser non dà il percorso completo).
  const Message = Type.Object({ message: Type.String() });
  app.post(
    '/api/projects/pick-folder',
    {
      schema: {
        body: PickFolderSchema,
        response: {
          200: Type.Object({ path: Type.Union([Type.String(), Type.Null()]) }),
          409: Message,
          502: Message,
          504: Message,
        },
      },
    },
    async (req, reply) => {
      try {
        return { path: await hub.pickFolder(req.body) };
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        if (reason === 'offline') return reply.code(409).send({ message: 'Runner non collegato' });
        if (reason === 'timeout') return reply.code(504).send({ message: 'Nessuna scelta' });
        return reply.code(502).send({ message: reason });
      }
    },
  );

  // Toglie il progetto dall'elenco di Jeko: la cartella e le run restano.
  app.delete(
    '/api/projects/:id',
    { schema: { params: Type.Object({ id: Id }) } },
    async (req, reply) =>
      (await projects.remove(req.params.id)) ? reply.code(204).send() : reply.callNotFound(),
  );
};
