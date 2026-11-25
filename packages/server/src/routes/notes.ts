import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { CreateNoteSchema, Id, NoteSchema, UpdateNoteSchema } from '@jeko/shared';
import { Type } from '@sinclair/typebox';
import type { NoteStore } from '../notes/store.js';
import type { ProjectStore } from '../projects/store.js';

/** Note: idee e problemi, con o senza progetto, da trasformare in task. */
export const noteRoutes: FastifyPluginAsyncTypebox<{
  notes: NoteStore;
  projects: ProjectStore;
}> = async (app, { notes, projects }) => {
  const Message = Type.Object({ message: Type.String() });
  /** Il progetto indicato non c'è: null o assente vanno bene. */
  const unknownProject = async (id: string | null | undefined) =>
    !!id && !(await projects.list()).some((p) => p.id === id);

  app.get('/api/notes', { schema: { response: { 200: Type.Array(NoteSchema) } } }, () =>
    notes.list(),
  );

  app.post(
    '/api/notes',
    { schema: { body: CreateNoteSchema, response: { 201: NoteSchema, 422: Message } } },
    async (req, reply) => {
      if (await unknownProject(req.body.projectId))
        return reply.code(422).send({ message: 'Progetto sconosciuto' });
      return reply.code(201).send(notes.add(req.body));
    },
  );

  app.patch(
    '/api/notes/:id',
    {
      schema: {
        params: Type.Object({ id: Id }),
        body: UpdateNoteSchema,
        response: { 200: NoteSchema, 422: Message },
      },
    },
    async (req, reply) => {
      if (await unknownProject(req.body.projectId))
        return reply.code(422).send({ message: 'Progetto sconosciuto' });
      return notes.update(req.params.id, req.body) ?? reply.callNotFound();
    },
  );

  app.delete('/api/notes/:id', { schema: { params: Type.Object({ id: Id }) } }, (req, reply) =>
    notes.remove(req.params.id) ? reply.code(204).send() : reply.callNotFound(),
  );
};
