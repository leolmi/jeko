import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { HealthSchema } from '@jeko/shared';
import { SettingsFile } from './data/files.js';
import { ProjectStore } from './projects/store.js';
import { TemplateStore, type TemplateFile } from './projects/templates.js';
import { appRoutes, type AppControl } from './routes/app.js';
import { projectRoutes } from './routes/projects.js';
import { runRoutes } from './routes/runs.js';
import { settingsRoutes } from './routes/settings.js';
import { setupRoutes } from './routes/setup.js';
import { staticRoutes } from './routes/static.js';
import { statsRoutes } from './routes/stats.js';
import { templateRoutes } from './routes/templates.js';
import { workflowRoutes } from './routes/workflows.js';
import { RunnerHub } from './runs/hub.js';
import { RunStore } from './runs/store.js';
import { UserSettingsStore } from './settings/store.js';
import { VERSION } from './version.js';
import { WorkflowStore } from './workflows/store.js';

export interface AppOptions {
  /** Cartella dei dati (`settings.json`, `projects.json`, `runs/`…). */
  dataDir: string;
  logger?: boolean | { level?: string; stream?: NodeJS.WritableStream };
  /** Build della web-app da servire su `/` (assente in sviluppo: c'è `ng serve`). */
  adminDir?: string | undefined;
  /** App desktop: aggiornamenti e uscita (assente nei test e in sviluppo). */
  control?: AppControl | undefined;
  /** Workflow e template di serie da caricare la prima volta. */
  seed?: { workflows: string[]; templates: TemplateFile[] } | undefined;
}

/** Origini ammesse: solo pagine servite dal PC stesso (l'app, `ng serve`). */
const LOCAL_ORIGIN = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;

export type JekoApp = FastifyInstance & { jeko: { hub: RunnerHub; runs: RunStore } };

export async function buildApp({
  dataDir,
  logger = false,
  adminDir,
  control,
  seed,
}: AppOptions): Promise<JekoApp> {
  const app = Fastify({ logger }).withTypeProvider<TypeBoxTypeProvider>();

  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
  await app.register(websocket);

  // Il servizio ascolta solo su 127.0.0.1, ma una pagina web qualsiasi aperta nel browser
  // potrebbe chiamarlo: le richieste con un'origine che non è del PC si rifiutano.
  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin;
    if (origin !== undefined && !LOCAL_ORIGIN.test(origin))
      return reply.code(403).send({ message: 'Origine non ammessa' });
  });

  const settingsFile = new SettingsFile(dataDir);
  const workflows = new WorkflowStore(dataDir, settingsFile);
  const runs = new RunStore(dataDir);
  const settings = new UserSettingsStore(settingsFile);
  const projects = new ProjectStore(dataDir);
  const templates = new TemplateStore(dataDir, settingsFile);
  if (seed) {
    await workflows.seed(seed.workflows);
    await templates.seed(seed.templates);
  }
  const hub = new RunnerHub(runs, workflows, settings, projects, app.log);

  // La pagina d'avvio dell'app (servita da Neutralino) aspetta il servizio leggendo qui.
  app.get('/api/health', { schema: { response: { 200: HealthSchema } } }, async (_req, reply) => {
    reply.header('access-control-allow-origin', '*');
    return { status: 'ok' as const, app: 'jeko' as const, version: VERSION, runner: hub.connected };
  });

  await app.register(projectRoutes, { projects, workflows, hub });
  await app.register(templateRoutes, { templates, runs, hub });
  await app.register(workflowRoutes, { workflows, projects, hub });
  await app.register(runRoutes, { runs, workflows, projects, hub });
  await app.register(statsRoutes, { runs, projects });
  await app.register(setupRoutes, { settings: settingsFile, workflows, hub, version: VERSION });
  await app.register(settingsRoutes, { settings });
  await app.register(appRoutes, { control, runs, version: VERSION });

  app.get('/ws/admin', { websocket: true }, (socket) => hub.attachAdmin(socket));

  if (adminDir) await app.register(staticRoutes, { root: adminDir });

  return Object.assign(app, { jeko: { hub, runs } }) as unknown as JekoApp;
}
