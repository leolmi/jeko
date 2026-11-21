import { describe, expect, it } from 'vitest';
import { directWorkflow, DIRECT_FOLLOW_UP } from './direct.js';
import { runPath } from './path.js';
import type { RunState } from './run.js';
import type { Workflow } from './schema.js';

const wf = {
  name: 'demo',
  kind: 'develop',
  version: 1,
  steps: [
    { id: 'a', type: 'agent', instructions: 'x' },
    { id: 'b', type: 'agent', instructions: 'x' },
    { id: 'c', type: 'agent', instructions: 'x' },
    { id: 'd', type: 'agent', instructions: 'x' },
  ],
} as Workflow;

const state = (stepIndex: number, steps: RunState['steps']): RunState => ({
  stepIndex,
  values: {},
  retries: {},
  steps,
});
const ok = { ok: true, output: '' };
const ko = { ok: false, output: '' };

describe('percorso delle run', () => {
  it('workflow: fatti, saltati, in corso e da fare', () => {
    const s = state(2, { a: ok });
    expect(runPath({ workflow: 'demo', status: 'running', definition: wf, state: s })).toEqual([
      'done',
      'skipped',
      'current',
      'pending',
    ]);
  });

  it('workflow fallito: il passo attuale è rosso', () => {
    const s = state(1, { a: ok });
    expect(runPath({ workflow: 'demo', status: 'failed', definition: wf, state: s })).toEqual([
      'done',
      'failed',
      'pending',
      'pending',
    ]);
  });

  it('workflow appena in coda: tutto da fare tranne il primo', () => {
    expect(runPath({ workflow: 'demo', status: 'queued', definition: wf, state: null })).toEqual([
      'current',
      'pending',
      'pending',
      'pending',
    ]);
  });

  it('task diretto: un pallino per turno, più quello in corso', () => {
    const definition = directWorkflow();
    const s = state(1, { diretto: ok, 'diretto-3': ko, 'diretto-2': ok });
    expect(runPath({ workflow: 'diretto', status: 'running', definition, state: s })).toEqual([
      'done',
      'done',
      'failed',
      'current',
    ]);
    // In attesa del messaggio seguente non c'è un turno in corso.
    const prompts = [{ status: 'pending', prompt: { stepId: DIRECT_FOLLOW_UP } }];
    expect(
      runPath({ workflow: 'diretto', status: 'waiting', definition, state: s, prompts }),
    ).toEqual(['done', 'done', 'failed']);
  });
});
