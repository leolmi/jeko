import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { SaveWorkflowSchema, WorkflowRecordSchema } from '@jeko/shared';
import { Type } from '@sinclair/typebox';
import type { WorkflowStore } from '../workflows/store.js';

const IssuesSchema = Type.Object({
  message: Type.String(),
  issues: Type.Array(
    Type.Object({
      path: Type.Array(Type.Union([Type.String(), Type.Number()])),
      message: Type.String(),
      line: Type.Optional(Type.Integer()),
      col: Type.Optional(Type.Integer()),
    }),
  ),
});

export const workflowRoutes: FastifyPluginAsyncTypebox<{ workflows: WorkflowStore }> = async (
  app,
  { workflows },
) => {
  app.get(
    '/api/workflows',
    { schema: { response: { 200: Type.Array(WorkflowRecordSchema) } } },
    () => workflows.list(),
  );

  app.get(
    '/api/workflows/:name',
    {
      schema: {
        params: Type.Object({ name: Type.String() }),
        response: { 200: Type.Array(WorkflowRecordSchema) },
      },
    },
    async (req, reply) => {
      const versions = await workflows.versions(req.params.name);
      return versions.length ? versions : reply.callNotFound();
    },
  );

  app.post(
    '/api/workflows',
    {
      schema: {
        body: SaveWorkflowSchema,
        response: { 201: WorkflowRecordSchema, 422: IssuesSchema },
      },
    },
    async (req, reply) => {
      const res = await workflows.save(req.body.yaml);
      if (!res.ok)
        return reply.code(422).send({ message: 'Workflow non valido', issues: res.issues });
      return reply.code(201).send(res.record);
    },
  );
};
