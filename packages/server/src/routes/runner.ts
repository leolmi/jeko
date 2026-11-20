import { createReadStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { installerScript, RUNNER_FILES } from '../runner/installer.js';
import { bearer, type RunnerTokens } from '../runner/token.js';

/** Installazione del runner: installer con token nuovo e file del runner da scaricare. */
export const runnerRoutes: FastifyPluginAsyncTypebox<{
  tokens: RunnerTokens;
  /** Cartella con il bundle del runner (`packages/runner/dist`). */
  runnerDist: string;
  /** Indirizzo del server come lo vede il PC del runner. */
  serverUrl: string;
}> = async (app, { tokens, runnerDist, serverUrl }) => {
  // Corpo JSON obbligatorio: da un'altra origine il browser dovrebbe chiedere il permesso (CORS),
  // quindi una pagina qualsiasi non può generare token.
  app.post(
    '/api/runner/installer',
    { schema: { body: Type.Object({}, { additionalProperties: false }) } },
    async (_req, reply) => {
      const token = await tokens.rotate();
      return reply
        .header('content-type', 'text/plain; charset=utf-8')
        .header('content-disposition', 'attachment; filename="jeko-runner-install.ps1"')
        .header('cache-control', 'no-store')
        .send(installerScript({ serverUrl, token, at: new Date() }));
    },
  );

  app.get(
    '/api/runner/files/:name',
    { schema: { params: Type.Object({ name: Type.String() }) } },
    async (req, reply) => {
      if (!(await tokens.verify(bearer(req.headers.authorization)))) return reply.code(401).send();
      const name = req.params.name;
      if (!(RUNNER_FILES as readonly string[]).includes(name)) return reply.code(404).send();
      const file = join(runnerDist, name);
      if (!existsSync(file)) {
        return reply
          .code(404)
          .send({ message: 'Runner non compilato: esegui npm run build -w @jeko/runner' });
      }
      return reply
        .header('content-type', 'text/javascript; charset=utf-8')
        .send(createReadStream(file));
    },
  );
};
