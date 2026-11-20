import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import {
  CREATION_WORKFLOW,
  creationWorkflow,
  CreateProjectRunSchema,
  IssueSchema,
  ProjectTemplateSchema,
  RunSummarySchema,
  SaveTemplateSchema,
  TemplateName,
  templateIssues,
} from '@jeko/shared';
import { Type } from '@sinclair/typebox';
import type { TemplateStore } from '../projects/templates.js';
import type { RunnerHub } from '../runs/hub.js';
import type { RunStore } from '../runs/store.js';

const Message = Type.Object({ message: Type.String() });
const IssuesSchema = Type.Object({ message: Type.String(), issues: Type.Array(IssueSchema) });
const NameParams = Type.Object({ name: TemplateName });

/** Template dei progetti e creazione di un progetto nuovo con l'AI. */
export const templateRoutes: FastifyPluginAsyncTypebox<{
  templates: TemplateStore;
  runs: RunStore;
  hub: RunnerHub;
}> = async (app, { templates, runs, hub }) => {
  app.get(
    '/api/templates',
    { schema: { response: { 200: Type.Array(ProjectTemplateSchema) } } },
    () => templates.list(),
  );

  // Il prompt usa i segnaposto dei workflow: si verifica prima di salvarlo.
  app.put(
    '/api/templates/:name',
    {
      schema: {
        params: NameParams,
        body: SaveTemplateSchema,
        response: { 200: ProjectTemplateSchema, 422: IssuesSchema },
      },
    },
    async (req, reply) => {
      const issues = templateIssues(req.body.prompt);
      if (issues.length) return reply.code(422).send({ message: 'Template non valido', issues });
      return templates.save(req.params.name, req.body.prompt);
    },
  );

  app.delete('/api/templates/:name', { schema: { params: NameParams } }, async (req, reply) =>
    (await templates.remove(req.params.name)) ? reply.code(204).send() : reply.callNotFound(),
  );

  // Nuovo progetto: una run che segue il template; a fine run il progetto si registra da solo.
  app.post(
    '/api/projects/create',
    {
      schema: {
        body: CreateProjectRunSchema,
        response: { 201: RunSummarySchema, 404: Message, 422: IssuesSchema },
      },
    },
    async (req, reply) => {
      const { name, request, template, mode } = req.body;
      const found = template ? await templates.get(template) : null;
      if (template && !found)
        return reply.code(404).send({ message: `Template '${template}' non trovato` });
      const issues = found ? templateIssues(found.prompt) : [];
      if (issues.length) return reply.code(422).send({ message: 'Template non valido', issues });
      const run = await runs.create({
        workflow: CREATION_WORKFLOW,
        version: 1,
        request,
        mode,
        inputs: { name: name.trim() },
        definition: creationWorkflow(found?.prompt),
      });
      await hub.start();
      return reply.code(201).send((await runs.get(run.id))!);
    },
  );
};
