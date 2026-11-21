import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import {
  AnswerSchema,
  directWorkflow,
  Id,
  RemoveRunsSchema,
  RunSummarySchema,
  StartRunSchema,
} from '@jeko/shared';
import { Type } from '@sinclair/typebox';
import type { ProjectStore } from '../projects/store.js';
import type { RunnerHub } from '../runs/hub.js';
import type { RunStore } from '../runs/store.js';
import type { WorkflowStore } from '../workflows/store.js';

const RunParams = Type.Object({ id: Id });

export const runRoutes: FastifyPluginAsyncTypebox<{
  runs: RunStore;
  workflows: WorkflowStore;
  projects: ProjectStore;
  hub: RunnerHub;
}> = async (app, { runs, workflows, projects, hub }) => {
  app.get('/api/runs', { schema: { response: { 200: Type.Array(RunSummarySchema) } } }, () =>
    runs.list(),
  );

  // Il dettaglio contiene eventi e richieste: già validati in ingresso, nessuno schema di risposta.
  app.get('/api/runs/:id', { schema: { params: RunParams } }, async (req, reply) => {
    const run = await runs.detail(req.params.id);
    return run ?? reply.callNotFound();
  });

  app.post(
    '/api/runs',
    {
      schema: {
        body: StartRunSchema,
        response: { 201: RunSummarySchema, 404: Type.Object({ message: Type.String() }) },
      },
    },
    async (req, reply) => {
      const { version, direct, agent: choice, ...body } = req.body;
      const project = await projects.byPath(req.body.cwd);
      // Ragionamento e modello: quelli del task, campo per campo, su quelli del progetto.
      const rest = { ...body, agent: { ...project?.agent, ...choice } };
      if (direct) {
        const definition = directWorkflow();
        const run = await runs.create({
          ...rest,
          workflow: definition.name,
          version: definition.version,
          definition,
        });
        await hub.start();
        return reply.code(201).send((await runs.get(run.id))!);
      }
      // Senza workflow: quello del progetto della cartella, o il predefinito di sviluppo.
      const workflow =
        req.body.workflow ?? project?.workflow ?? (await workflows.defaultOf('develop'));
      const def = workflow ? await workflows.definition(workflow, version) : null;
      if (!workflow || def?.workflow.kind !== 'develop')
        return reply.code(404).send({ message: `Workflow '${workflow ?? ''}' non trovato` });
      const run = await runs.create({
        ...rest,
        workflow,
        version: def.version,
        definition: def.workflow,
      });
      await hub.start();
      return reply.code(201).send((await runs.get(run.id))!);
    },
  );

  app.post(
    '/api/runs/:id/prompts/:promptId',
    { schema: { params: Type.Object({ id: Id, promptId: Id }), body: AnswerSchema } },
    async (req, reply) => {
      const outcome = await hub.answer(req.params.id, req.params.promptId, req.body);
      switch (outcome) {
        case 'ok':
          return reply.code(204).send();
        case 'not-found':
          return reply.callNotFound();
        case 'already-answered':
          return reply.code(409).send({ message: 'Richiesta già chiusa' });
        case 'wrong-kind':
          return reply.code(400).send({ message: 'Tipo di risposta non adatto alla richiesta' });
      }
    },
  );

  // Elimina i task conclusi (con eventi e richieste); quelli ancora aperti non si toccano.
  app.post(
    '/api/runs/remove',
    {
      schema: {
        body: RemoveRunsSchema,
        response: { 200: Type.Object({ removed: Type.Array(Type.String()) }) },
      },
    },
    async (req) => {
      const removed = await runs.remove(req.body.ids);
      hub.runsRemoved(removed);
      return { removed };
    },
  );

  app.post('/api/runs/:id/cancel', { schema: { params: RunParams } }, async (req, reply) => {
    if (!(await runs.get(req.params.id))) return reply.callNotFound();
    if (!(await hub.cancel(req.params.id))) {
      return reply.code(409).send({ message: 'La run è già conclusa' });
    }
    return reply.code(202).send();
  });
};
