import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import {
  AssistWorkflowSchema,
  IssueSchema,
  parseWorkflow,
  SaveWorkflowSchema,
  WorkflowProposalSchema,
  WorkflowRecordSchema,
  type WorkflowCheck,
} from '@jeko/shared';
import { Type } from '@sinclair/typebox';
import type { RunnerHub } from '../runs/hub.js';
import { assistWorkflow } from '../workflows/assist.js';
import type { WorkflowStore } from '../workflows/store.js';

const IssuesSchema = Type.Object({ message: Type.String(), issues: Type.Array(IssueSchema) });
const Message = Type.Object({ message: Type.String() });

export const workflowRoutes: FastifyPluginAsyncTypebox<{
  workflows: WorkflowStore;
  hub: RunnerHub;
}> = async (app, { workflows, hub }) => {
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

  // Verifica senza salvare: per l'editor, mentre si scrive.
  app.post(
    '/api/workflows/check',
    { schema: { body: SaveWorkflowSchema } },
    async (req): Promise<WorkflowCheck> => parseWorkflow(req.body.yaml) as WorkflowCheck,
  );

  // Modifica chiesta all'AI (claude sul PC, tramite il runner): una proposta, mai salvata.
  app.post(
    '/api/workflows/assist',
    {
      schema: {
        body: AssistWorkflowSchema,
        response: { 200: WorkflowProposalSchema, 409: Message, 502: Message, 504: Message },
      },
    },
    async (req, reply) => {
      try {
        return await assistWorkflow((p) => hub.assist(p), req.body.yaml, req.body.request);
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        if (reason === 'offline') return reply.code(409).send({ message: 'Runner non collegato' });
        if (reason === 'timeout')
          return reply.code(504).send({ message: 'claude non ha risposto' });
        return reply.code(502).send({ message: reason });
      }
    },
  );
};
