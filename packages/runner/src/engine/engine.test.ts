import {
  creationWorkflow,
  parseWorkflow,
  type RunEvent,
  type RunMode,
  type Workflow,
} from '@jeko/shared';
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
    {
      runId: 'r1',
      workflow: w,
      request: 'crea Jeko',
      mode,
      settings: { projectsDir: 'progetti' },
      ...(inputs && { inputs }),
    },
    f.host,
  );

/** Creazione di un progetto da un template. */
const example = creationWorkflow('Stack: Angular per {{ name }}.');

describe('domande di claude (AskUserQuestion) nelle tre modalità', () => {
  const w = wf(`
name: domande
version: 1
kind: develop
steps:
  - { id: lavoro, type: agent, instructions: lavora }
`);
  it.each([
    ['headless', false],
    ['checkpoint', true],
    ['interactive', true],
  ] as const)('%s: domanda in chat = %s', async (mode, asks) => {
    let answer: string | null | undefined;
    const f = fakeHost({
      answers: ['blu'],
      agent: async (req) => {
        answer = await req.askUser?.({ question: 'Colore?', options: [{ label: 'blu' }] });
        return { ok: true, output: 'fatto' };
      },
    });
    const res = await run(w, f, mode);
    expect(res.status).toBe('done');
    expect(f.asked).toEqual(asks ? ['lavoro'] : []);
    expect(answer).toBe(asks ? 'blu' : undefined);
  });
});

describe('motore', () => {
  it('crea un progetto da un template con gli input già ricavati', async () => {
    const files: Record<string, string> = {};
    const f = fakeHost({
      files,
      agent: async (req) => {
        if (req.stepId === 'gitignore') files['progetti/gestione-clienti/.gitignore'] = '.idea/\n';
        if (req.stepId === 'conoscenza')
          files['progetti/gestione-clienti/.jeko/project.md'] = '# Gestione Clienti';
        return { ok: true, output: 'ok', sessionId: 's1' };
      },
    });
    const out = await run(example, f, 'headless', { name: 'Gestione Clienti' });

    expect(out).toMatchObject({ status: 'done' });
    expect(f.asked).toEqual([]);
    expect(f.agentCalls[0]?.instructions).toContain(
      'Crea il progetto Gestione Clienti nella cartella progetti/gestione-clienti',
    );
    expect(f.agentCalls[0]?.instructions).toContain('Stack: Angular per Gestione Clienti.');
    expect(f.agentCalls[1]?.sessionId).toBe('s1');
    expect(f.execCalls).toEqual([
      { argv: ['git', 'init', '-b', 'main'], cwd: 'progetti/gestione-clienti' },
    ]);
    expect(f.agentCalls.find((c) => c.stepId === 'conoscenza')?.cwd).toBe(
      'progetti/gestione-clienti',
    );
  });

  it('i check con commands usano i comandi del progetto, saltando i mancanti', async () => {
    const w = wf(`
name: t
kind: develop
version: 1
steps:
  - id: verifica
    type: check
    commands: [typecheck, lint, test]
    exec: [[node, -v]]
`);
    const f = fakeHost({});
    f.host.projectCommands = async () => ({ test: ['npm', 'test'], typecheck: ['tsc'] });
    expect((await run(w, f)).status).toBe('done');
    expect(f.execCalls.map((c) => c.argv)).toEqual([['tsc'], ['npm', 'test'], ['node', '-v']]);

    const bad = fakeHost({});
    bad.host.projectCommands = async () => {
      throw new Error('commands.yaml: comando non valido');
    };
    const out = await run(w, bad);
    expect(out.status).toBe('failed');
    expect(out.error).toContain('commands.yaml: comando non valido');
  });

  it('chiede gli input mancanti', async () => {
    const files: Record<string, string> = {};
    const f = fakeHost({ answers: ['Prova'], files });
    f.host.agent = async (req) => {
      f.agentCalls.push(req);
      files['progetti/prova/.gitignore'] = '.idea/';
      files['progetti/prova/.jeko/project.md'] = '# Prova';
      return { ok: true, output: '' };
    };
    const out = await run(example, f);
    expect(out.status).toBe('done');
    expect(f.asked).toEqual(['input:name']);
    expect(f.events).toContainEqual(
      expect.objectContaining({ type: 'step.started', stepId: 'git', title: 'Inizializza git' }),
    );
  });

  it("salta i passi esclusi da when, anche in base all'uscita di un passo", async () => {
    const w = wf(`
name: t
kind: develop
version: 1
steps:
  - { id: richiesta, type: agent, instructions: classifica }
  - id: bug
    type: agent
    instructions: riproduci
    when: "startsWith(lower(trim(steps.richiesta.output)), 'tipo: fix')"
  - { id: piano, type: agent, instructions: pianifica, effort: high }
`);
    for (const [output, steps] of [
      ['TIPO: fix\\nil bottone non salva', ['richiesta', 'bug', 'piano']],
      ['TIPO: implementazione\\nnuovo filtro', ['richiesta', 'piano']],
    ] as const) {
      const f = fakeHost({ agent: async () => ({ ok: true, output }) });
      expect((await run(w, f, 'headless')).status).toBe('done');
      expect(f.agentCalls.map((c) => c.stepId)).toEqual(steps);
      expect(f.agentCalls.at(-1)?.effort).toBe('high');
    }
  });

  it('richiede di nuovo un valore fuori enum', async () => {
    const w = wf(`
name: t
kind: develop
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
    const f = fakeHost({ files: { 'progetti/jeko': '' } });
    const out = await run(example, f, 'headless', { name: 'Jeko' });
    expect(out.status).toBe('failed');
    expect(out.error).toContain("Controllo 'check-dir' fallito");
    expect(f.agentCalls).toEqual([]);
  });

  it('si ferma se nelle opzioni manca la cartella dei progetti', async () => {
    const f = fakeHost({});
    const out = await runWorkflow(
      {
        runId: 'r1',
        workflow: example,
        request: 'crea Jeko',
        mode: 'headless',
        inputs: { name: 'Jeko' },
      },
      f.host,
    );
    expect(out.status).toBe('failed');
    expect(out.error).toContain("Controllo 'projects-dir' fallito");
    expect(f.execCalls).toEqual([]);
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
