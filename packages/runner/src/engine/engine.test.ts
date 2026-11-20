import { readFileSync } from 'node:fs';
import { parseWorkflow, type RunEvent, type RunMode, type Workflow } from '@jeko/shared';
import { describe, expect, it } from 'vitest';
import { runWorkflow, type AgentRequest, type Host, type Review } from './engine.js';

function wf(yaml: string): Workflow {
  const r = parseWorkflow(yaml);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.workflow;
}

interface Fake {
  host: Host;
  events: RunEvent[];
  agentCalls: AgentRequest[];
  execCalls: { argv: string[]; cwd: string | undefined }[];
  asked: string[];
  approvals: string[];
}

function fakeHost(opts: {
  answers?: (string | null)[];
  approve?: boolean[];
  reviews?: Review[];
  exec?: (argv: string[]) => number;
  agent?: (req: AgentRequest) => Promise<{ ok: boolean; output: string; sessionId?: string }>;
  files?: Record<string, string>;
}): Fake {
  const answers = [...(opts.answers ?? [])];
  const approve = [...(opts.approve ?? [])];
  const reviews = [...(opts.reviews ?? [])];
  const f: Fake = {
    events: [],
    agentCalls: [],
    execCalls: [],
    asked: [],
    approvals: [],
    host: null!,
  };
  f.host = {
    ask: async (req) => {
      f.asked.push(req.stepId);
      return answers.length ? answers.shift()! : null;
    },
    approve: async (req) => {
      f.approvals.push(`${req.reason}:${req.stepId}`);
      return { approved: approve.length ? approve.shift()! : true };
    },
    review: async () => reviews.shift() ?? { ok: true },
    agent: async (req) => {
      f.agentCalls.push(req);
      return opts.agent ? opts.agent(req) : { ok: true, output: 'fatto', sessionId: 'sess' };
    },
    exec: async (argv, cwd) => {
      f.execCalls.push({ argv, cwd });
      return { code: opts.exec ? opts.exec(argv) : 0, stdout: '', stderr: 'errore' };
    },
    functions: {
      exists: (p) => typeof p === 'string' && p in (opts.files ?? {}),
      fileContains: (p, t) =>
        typeof p === 'string' && typeof t === 'string' && (opts.files?.[p] ?? '').includes(t),
    },
    emit: (e) => f.events.push(e),
  };
  return f;
}

const run = (w: Workflow, f: Fake, mode: RunMode = 'checkpoint', inputs?: Record<string, string>) =>
  runWorkflow(
    { runId: 'r1', workflow: w, request: 'crea Jeko', mode, ...(inputs && { inputs }) },
    f.host,
  );

const example = wf(
  readFileSync(new URL('../../../shared/workflows/nuovo-progetto.yaml', import.meta.url), 'utf8'),
);

describe('motore', () => {
  it('esegue nuovo-progetto con gli input già ricavati', async () => {
    const files: Record<string, string> = {};
    const f = fakeHost({
      files,
      agent: async (req) => {
        if (req.stepId === 'gitignore')
          files['C:\\Leo\\sviluppo\\gestione-clienti/.gitignore'] = '.idea/\n';
        return { ok: true, output: 'ok', sessionId: 's1' };
      },
    });
    const out = await run(example, f, 'headless', {
      name: 'Gestione Clienti',
      type: 'semplice',
      stack: 'Angular',
    });

    expect(out).toMatchObject({ status: 'done' });
    expect(f.asked).toEqual([]);
    expect(f.agentCalls[0]?.instructions).toContain(
      'Crea un progetto semplice con stack Angular in C:\\Leo\\sviluppo\\gestione-clienti',
    );
    expect(f.agentCalls[1]?.sessionId).toBe('s1');
    expect(f.execCalls).toEqual([
      { argv: ['git', 'init', '-b', 'main'], cwd: 'C:\\Leo\\sviluppo\\gestione-clienti' },
    ]);
    // Il gate del commit è "always": si ferma anche in headless.
    expect(f.approvals).toEqual(['gate:commit']);
  });

  it('chiede gli input mancanti e salta i passi esclusi da when', async () => {
    const files: Record<string, string> = {};
    const f = fakeHost({ answers: ['Prova', 'vuoto'], files });
    f.host.agent = async (req) => {
      f.agentCalls.push(req);
      files['C:\\Leo\\sviluppo\\prova/.gitignore'] = '.idea/';
      return { ok: true, output: '' };
    };
    const out = await run(example, f);
    expect(out.status).toBe('done');
    expect(f.asked).toEqual(['input:name', 'input:type']);
    expect(out.state.values['stack']).toBeNull();
    expect(f.events).toContainEqual({ runId: 'r1', type: 'step.skipped', stepId: 'scaffold' });
  });

  it('richiede di nuovo un valore fuori enum', async () => {
    const w = wf(`
name: t
kind: create
version: 1
inputs:
  colore: { prompt: Colore?, enum: [rosso, blu], required: true }
steps:
  - { id: g, type: gate, message: '{{ colore }}', level: always }
`);
    const f = fakeHost({ answers: ['verde', 'blu'] });
    const out = await run(w, f);
    expect(out.status).toBe('done');
    expect(out.state.values['colore']).toBe('blu');
  });

  it('si ferma se la cartella esiste già', async () => {
    const f = fakeHost({ files: { 'C:\\Leo\\sviluppo\\jeko': '' } });
    const out = await run(example, f, 'headless', { name: 'Jeko', type: 'vuoto' });
    expect(out.status).toBe('failed');
    expect(out.error).toContain("Controllo 'check-dir' fallito");
    expect(f.agentCalls).toEqual([]);
  });

  it('un gate rifiutato chiude la run come rejected', async () => {
    const w = wf(`
name: t
kind: develop
version: 1
steps:
  - { id: piano, type: gate, message: Procedo? }
  - { id: lavoro, type: agent, instructions: lavora }
`);
    const f = fakeHost({ approve: [false] });
    const out = await run(w, f);
    expect(out.status).toBe('rejected');
    expect(f.agentCalls).toEqual([]);
  });

  it('in headless i gate interactive non si fermano', async () => {
    const w = wf(`
name: t
kind: develop
version: 1
steps:
  - { id: piano, type: gate, message: Procedo? }
`);
    const f = fakeHost({});
    expect((await run(w, f, 'headless')).status).toBe('done');
    expect(f.approvals).toEqual([]);
  });

  it('check fallito torna al passo indicato con il motivo, fino ai tentativi massimi', async () => {
    const w = wf(`
name: t
kind: develop
version: 1
steps:
  - { id: fix, type: agent, instructions: Correggi i test }
  - id: test
    type: check
    exec: [[npm, test]]
    onFail: { goto: fix, retries: 2 }
`);
    let failures = 2;
    const f = fakeHost({ exec: () => (failures-- > 0 ? 1 : 0) });
    const out = await run(w, f);
    expect(out.status).toBe('done');
    expect(f.agentCalls).toHaveLength(3);
    expect(f.agentCalls[1]?.instructions).toContain("'npm test' è uscito con codice 1");
    expect(out.state.lastFailure).toBeUndefined();

    const g = fakeHost({ exec: () => 1 });
    const failed = await run(w, g);
    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('dopo 2 tentativi');
    expect(g.agentCalls).toHaveLength(3);
  });

  it('le policy fermano i comandi sensibili dei check e degli agent', async () => {
    const w = wf(`
name: t
kind: develop
version: 1
policies:
  - { match: install, gate: always }
steps:
  - { id: deps, type: check, exec: [[npm, install]] }
  - { id: lavoro, type: agent, instructions: lavora }
`);
    let allowed: boolean[] = [];
    const f = fakeHost({
      approve: [true, false],
      agent: async (req) => {
        expect(req.gates).toEqual({
          policies: [{ match: 'install', gate: 'always' }],
          mode: 'headless',
        });
        allowed = [
          await req.authorize('Bash', { command: 'npm i zod' }),
          await req.authorize('Bash', { command: 'npm test' }),
        ];
        return { ok: true, output: '' };
      },
    });
    const out = await run(w, f, 'headless');
    expect(out.status).toBe('done');
    expect(f.approvals).toEqual(['policy:deps', 'policy:lavoro']);
    expect(allowed).toEqual([false, true]);

    const g = fakeHost({ approve: [false] });
    const rejected = await run(w, g, 'headless');
    expect(rejected.status).toBe('rejected');
    expect(g.execCalls).toEqual([]);
  });

  it('in interactive rifà il passo agent con il feedback', async () => {
    const w = wf(`
name: t
kind: develop
version: 1
steps:
  - { id: lavoro, type: agent, instructions: Scrivi il README }
`);
    const f = fakeHost({ reviews: [{ ok: false, feedback: 'più corto' }, { ok: true }] });
    const out = await run(w, f, 'interactive');
    expect(out.status).toBe('done');
    expect(f.agentCalls.map((c) => c.instructions)).toEqual(['Scrivi il README', 'più corto']);
    expect(f.agentCalls[1]?.sessionId).toBe('sess');
  });

  it('riprende da uno stato salvato', async () => {
    const w = wf(`
name: t
kind: develop
version: 1
inputs:
  x: { prompt: X, required: true }
steps:
  - { id: a, type: agent, instructions: 'a {{ x }}' }
  - { id: b, type: agent, instructions: 'b {{ x }}' }
`);
    const f = fakeHost({});
    const out = await runWorkflow(
      {
        runId: 'r2',
        workflow: w,
        request: '',
        mode: 'headless',
        state: { stepIndex: 1, values: { x: '1' }, retries: {}, steps: {}, sessionId: 'old' },
      },
      f.host,
    );
    expect(out.status).toBe('done');
    expect(f.asked).toEqual([]);
    expect(f.agentCalls.map((c) => [c.instructions, c.sessionId])).toEqual([['b 1', 'old']]);
  });
});
