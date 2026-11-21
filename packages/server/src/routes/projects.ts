import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import {
  ContextInventorySchema,
  CreateProjectSchema,
  Id,
  IssueSchema,
  PickFolderSchema,
  ProjectPromptSchema,
  ProjectSchema,
  PromptName,
  promptIssues,
  SaveProjectPromptSchema,
  UpdateProjectSchema,
} from '@jeko/shared';
import type { FastifyReply } from 'fastify';
import { Type } from '@sinclair/typebox';
import type { ProjectStore } from '../projects/store.js';
import type { RunnerHub } from '../runs/hub.js';
import type { WorkflowStore } from '../workflows/store.js';

/** Progetti gestiti: elenco, aggiunta di una cartella esistente, rimozione dall'elenco. */
export const projectRoutes: FastifyPluginAsyncTypebox<{
  projects: ProjectStore;
  workflows: WorkflowStore;
  hub: RunnerHub;
}> = async (app, { projects, workflows, hub }) => {
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

  // Workflow che guida i task del progetto: uno di sviluppo, o null per il predefinito.
  app.patch(
    '/api/projects/:id',
    {
      schema: {
        params: Type.Object({ id: Id }),
        body: UpdateProjectSchema,
        response: { 200: ProjectSchema, 422: Type.Object({ message: Type.String() }) },
      },
    },
    async (req, reply) => {
      const { workflow } = req.body;
      if (workflow !== undefined && workflow !== null) {
        const def = await workflows.definition(workflow);
        if (def?.workflow.kind !== 'develop')
          return reply.code(422).send({ message: `'${workflow}' non è un workflow di sviluppo` });
      }
      const project = await projects.update(req.params.id, req.body);
      return project ?? reply.callNotFound();
    },
  );

  // Dialogo di scelta cartella sul PC del runner (il browser non dà il percorso completo).
  const Message = Type.Object({ message: Type.String() });

  /** Cartella del progetto: undefined se il progetto non c'è, '' se non ne ha. */
  const folderOf = async (id: string) => (await projects.list()).find((p) => p.id === id)?.path;
  /** Richiesta al runner fallita: codice HTTP e messaggio. */
  const runnerFailure = (e: unknown) => {
    const r = e instanceof Error ? e.message : String(e);
    if (r === 'offline') return { code: 409 as const, message: 'Runner non collegato' };
    if (r === 'timeout') return { code: 504 as const, message: 'Nessuna risposta dal runner' };
    return { code: 502 as const, message: r };
  };

  // Terminale sul PC del runner nella cartella del progetto: login, dati sensibili…
  app.post(
    '/api/projects/:id/terminal',
    {
      schema: {
        params: Type.Object({ id: Id }),
        response: { 204: Type.Null(), 409: Message, 422: Message, 502: Message, 504: Message },
      },
    },
    async (req, reply) => {
      const path = await folderOf(req.params.id);
      if (path === undefined) return reply.callNotFound();
      if (!path) return reply.code(422).send({ message: 'Il progetto non ha cartella' });
      try {
        await hub.openTerminal(path);
        return reply.code(204).send(null);
      } catch (e) {
        const { code, message } = runnerFailure(e);
        return reply.code(code).send({ message });
      }
    },
  );

  // Cosa claude carica all'avvio nella cartella del progetto: lo legge il runner.
  app.get(
    '/api/projects/:id/context',
    {
      schema: {
        params: Type.Object({ id: Id }),
        response: {
          200: ContextInventorySchema,
          409: Message,
          422: Message,
          502: Message,
          504: Message,
        },
      },
    },
    async (req, reply) => {
      const path = await folderOf(req.params.id);
      if (path === undefined) return reply.callNotFound();
      if (!path) return reply.code(422).send({ message: 'Il progetto non ha cartella' });
      try {
        return await hub.contextInventory(path);
      } catch (e) {
        const { code, message } = runnerFailure(e);
        return reply.code(code).send({ message });
      }
    },
  );

  // Prompt del progetto (.jeko/prompts/): li legge e scrive il runner, nella cartella.
  const PromptsResponse = {
    200: Type.Array(ProjectPromptSchema),
    409: Message,
    422: Type.Object({ message: Type.String(), issues: Type.Optional(Type.Array(IssueSchema)) }),
    502: Message,
    504: Message,
  };
  const prompts = async (
    id: string,
    op: Parameters<RunnerHub['projectPrompts']>[1],
    reply: FastifyReply,
  ) => {
    const path = await folderOf(id);
    if (path === undefined) return reply.callNotFound();
    if (!path) return reply.code(422).send({ message: 'Il progetto non ha cartella' });
    try {
      return await hub.projectPrompts(path, op);
    } catch (e) {
      const { code, message } = runnerFailure(e);
      return reply.code(code).send({ message });
    }
  };
  const PromptParams = Type.Object({ id: Id, name: PromptName });

  app.get(
    '/api/projects/:id/prompts',
    { schema: { params: Type.Object({ id: Id }), response: PromptsResponse } },
    (req, reply) => prompts(req.params.id, { kind: 'list' }, reply),
  );

  // Il prompt usa i segnaposto dei workflow: si verifica prima di salvarlo.
  app.put(
    '/api/projects/:id/prompts/:name',
    { schema: { params: PromptParams, body: SaveProjectPromptSchema, response: PromptsResponse } },
    async (req, reply) => {
      const issues = promptIssues(req.body.text);
      if (issues.length) return reply.code(422).send({ message: 'Prompt non valido', issues });
      return prompts(
        req.params.id,
        { kind: 'save', name: req.params.name, text: req.body.text },
        reply,
      );
    },
  );

  app.delete(
    '/api/projects/:id/prompts/:name',
    { schema: { params: PromptParams, response: PromptsResponse } },
    (req, reply) => prompts(req.params.id, { kind: 'delete', name: req.params.name }, reply),
  );
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
