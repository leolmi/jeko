// Prova manuale con claude vero (usa il login del CLI, pochi token):
//   npm run build -w @jeko/runner && npx tsx packages/runner/scripts/prova-permessi.mts
// 1. un git push consentito da allowedTools arriva comunque a Jeko (hook) ed è rifiutato;
// 2. il "runner" esce mentre claude lavora: un runner nuovo riaggancia il turno (stessa pipe,
//    stesso token) e decide lui il permesso del push.
import { execSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentRequest } from '../src/engine/engine.ts';
import { createPermissionBridge } from '../src/permissions/bridge.ts';
import { ApprovalEndpoint, pipePath } from '../src/permissions/endpoint.ts';
import { claudeDriver } from '../src/agents/claude/index.ts';
import { durableTurn } from '../src/turn.ts';

const PROMPT =
  'Esegui con lo strumento Bash, uno alla volta, esattamente questi comandi: ' +
  '`node -e "setTimeout(() => {}, 8000)"`, poi `git status --short`, poi `git push origin HEAD:main`. ' +
  "Non provare alternative. Rispondi in una riga con l'esito di ciascuno.";
const ALLOWED = ['Bash(node -e:*)', 'Bash(git status:*)', 'Bash(git push:*)'];

/** Un "runner": endpoint sulla pipe data e un turno nella cartella data. */
async function runner(pipe: string, dir: string, work: string, asked: string[]) {
  const ep = new ApprovalEndpoint(pipe);
  await ep.start();
  const bridge = createPermissionBridge({
    endpoint: ep,
    scriptsDir: join(import.meta.dirname, '..', 'dist'),
  });
  const req: AgentRequest = {
    stepId: 'prova',
    instructions: PROMPT,
    turnKey: 'prova-0',
    gates: { policies: [{ match: 'git.push', gate: 'always' }], mode: 'headless' },
    authorize: async (call) => {
      const cmd = call.target;
      asked.push(`${call.name}: ${cmd}`);
      return !/git\s+push/.test(cmd);
    },
  };
  const res = await durableTurn({
    dir,
    agent: claudeDriver(),
    prompt: PROMPT,
    cwd: work,
    allowedTools: ALLOWED,
    permissions: (d, token) => bridge(req, d, token),
  });
  await ep.stop();
  return res;
}

const [, , phase, pipeArg, dirArg, workArg] = process.argv;
if (phase === '--primo') {
  // Primo runner: avvia il turno ed esce dopo pochi secondi, mentre claude lavora.
  setTimeout(() => process.exit(0), 5000);
  await runner(pipeArg!, dirArg!, workArg!, []);
} else {
  const root = mkdtempSync(join(tmpdir(), 'jeko-prova-'));
  const work = join(root, 'work');
  const sh = (c: string, cwd = root) => execSync(c, { cwd, stdio: 'pipe' }).toString().trim();
  sh('git init -q --bare remote.git');
  sh('git init -q -b main work');
  writeFileSync(join(work, 'a.txt'), 'ciao\n');
  sh(
    'git add . && git -c user.name=t -c user.email=t@t commit -qm init && git remote add origin ../remote.git',
    work,
  );
  const pipe = pipePath();
  const dir = join(root, 'turn');
  const t0 = Date.now();

  const first = spawn(
    process.execPath,
    ['--import', 'tsx', fileURLToPath(import.meta.url), '--primo', pipe, dir, work],
    { stdio: 'inherit' },
  );
  await new Promise((r) => first.once('exit', r));
  console.log(`primo runner uscito dopo ${Math.round((Date.now() - t0) / 1000)}s`);

  const asked: string[] = [];
  const res = await runner(pipe, dir, work, asked);
  console.log('secondi:', Math.round((Date.now() - t0) / 1000));
  console.log('richieste al secondo runner:', asked);
  console.log('esito:', res.ok, res.output);
  console.log(
    'commit sul remote:',
    sh('git log --oneline --all', join(root, 'remote.git')) || '(nessuno)',
  );
}
