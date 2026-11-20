// Prova manuale con claude vero (usa il login del CLI, pochi token):
//   npx tsx packages/runner/scripts/prova-domande.mts
// claude usa AskUserQuestion: la domanda arriva a Jeko (hook + server MCP), la "chat" risponde
// e claude deve vedere la risposta.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentQuestion, AgentRequest } from '../src/engine/engine.ts';
import { createPermissionBridge } from '../src/permissions/bridge.ts';
import { ApprovalEndpoint } from '../src/permissions/endpoint.ts';
import { durableTurn } from '../src/turn.ts';

const PROMPT =
  'Usa lo strumento AskUserQuestion per chiedermi quale colore preferisco, con le opzioni ' +
  '"rosso" e "blu". Poi rispondi in una sola riga: "Colore scelto: <risposta>".';

const root = mkdtempSync(join(tmpdir(), 'jeko-domande-'));
const ep = new ApprovalEndpoint();
await ep.start();
const bridge = createPermissionBridge({
  endpoint: ep,
  scriptsDir: join(import.meta.dirname, '..', 'src'),
});
const asked: AgentQuestion[] = [];
const req: AgentRequest = {
  stepId: 'prova',
  instructions: PROMPT,
  turnKey: 'prova-0',
  gates: { policies: [], mode: 'headless' },
  authorize: async () => true,
  askUser: async (q) => {
    asked.push(q);
    return 'blu';
  },
};
const res = await durableTurn({
  dir: join(root, 'turn'),
  command: ['claude'],
  prompt: PROMPT,
  cwd: root,
  permissions: (d, token) => bridge(req, d, token),
  onActivity: (a) => console.log(`  [${a.kind}] ${a.kind === 'tool' ? `${a.tool} ` : ''}${a.text}`),
});
await ep.stop();

console.log('domande arrivate a Jeko:', JSON.stringify(asked, null, 2));
console.log('risultato:', res.output);
const ok = asked.length > 0 && /blu/i.test(res.output);
console.log(ok ? 'OK: claude ha ricevuto la risposta' : 'KO');
process.exit(ok ? 0 : 1);
