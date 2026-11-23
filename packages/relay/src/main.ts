/** Relay da solo: `node src/main.ts` (PORT=8787, HOST=0.0.0.0, RELAY_DATA=./data, RELAY_SECRET). */
import { join } from 'node:path';
import { buildRelay } from './relay.ts';

const app = await buildRelay({
  dataDir: process.env['RELAY_DATA'] ?? join(process.cwd(), 'data'),
  secret: process.env['RELAY_SECRET'],
  logger: true,
});
await app.listen({
  host: process.env['HOST'] ?? '0.0.0.0',
  port: Number(process.env['PORT'] ?? 8787),
});
