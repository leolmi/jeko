import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Id, type RunDetail } from '@jeko/shared';
import { Type } from '@sinclair/typebox';
import type { ProjectStore } from '../projects/store.js';
import type { RunStore } from '../runs/store.js';
import { computeStats } from '../stats/stats.js';

/** Statistiche delle run presenti: di un progetto o di tutti, degli ultimi N giorni o di sempre. */
export const statsRoutes: FastifyPluginAsyncTypebox<{
  runs: RunStore;
  projects: ProjectStore;
}> = async (app, { runs, projects }) => {
  app.get(
    '/api/stats',
    {
      schema: {
        querystring: Type.Object({
          project: Type.Optional(Id),
          days: Type.Optional(Type.Integer({ minimum: 1, maximum: 3660 })),
        }),
      },
    },
    async (req, reply) => {
      const all = await projects.list();
      const project = req.query.project ? all.find((p) => p.id === req.query.project) : undefined;
      if (req.query.project && !project) return reply.callNotFound();
      const details: RunDetail[] = [];
      for (const r of await runs.list(Number.POSITIVE_INFINITY)) {
        const d = await runs.detail(r.id);
        if (d) details.push(d);
      }
      return computeStats(details, all, {
        ...(project && { project }),
        ...(req.query.days !== undefined && { days: req.query.days }),
      });
    },
  );
};
