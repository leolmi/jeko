import type { RunDetail } from '@jeko/shared';
import { buildTimeline } from './timeline';

const T = (s: number) => new Date(Date.UTC(2026, 0, 1, 10, 0, s)).toISOString();

const run: RunDetail = {
  id: '00000000-0000-4000-8000-000000000001',
  workflow: 'demo',
  version: 1,
  request: 'Fai qualcosa',
  mode: 'checkpoint',
  status: 'done',
  error: null,
  createdAt: T(0),
  updatedAt: T(9),
  events: [
    {
      seq: 1,
      at: T(1),
      event: { runId: 'r', type: 'run.started', workflow: 'demo', version: 1, mode: 'checkpoint' },
    },
    { seq: 2, at: T(2), event: { runId: 'r', type: 'step.started', stepId: 'lavoro', index: 0 } },
    {
      seq: 3,
      at: T(3),
      event: { runId: 'r', type: 'step.finished', stepId: 'lavoro', ok: true, output: 'fatto' },
    },
    { seq: 4, at: T(3), event: { runId: 'r', type: 'step.skipped', stepId: 'extra' } },
    { seq: 5, at: T(4), event: { runId: 'r', type: 'step.started', stepId: 'commit', index: 2 } },
    {
      seq: 6,
      at: T(6),
      event: { runId: 'r', type: 'step.finished', stepId: 'commit', ok: true, output: 'approvato' },
    },
    {
      seq: 7,
      at: T(7),
      event: {
        runId: 'r',
        type: 'state',
        state: { stepIndex: 3, values: {}, retries: {}, steps: {} },
      },
    },
    { seq: 8, at: T(7), event: { runId: 'r', type: 'run.finished', status: 'done' } },
  ],
  prompts: [
    {
      id: '00000000-0000-4000-8000-000000000002',
      runId: 'r',
      prompt: { kind: 'approve', stepId: 'commit', message: 'Commit?', reason: 'gate' },
      answer: { kind: 'approve', approved: true },
      status: 'answered',
      createdAt: T(5),
    },
  ],
};

describe('buildTimeline', () => {
  it('unisce avvio e fine dei passi e mette le richieste al loro posto', () => {
    const items = buildTimeline(run);
    expect(items.map((i) => i.kind)).toEqual([
      'request',
      'step',
      'step',
      'step',
      'prompt',
      'finished',
    ]);
    expect(items[1]).toMatchObject({ stepId: 'lavoro', state: 'ok', output: 'fatto' });
    expect(items[2]).toMatchObject({ stepId: 'extra', state: 'skipped' });
    expect(items[3]).toMatchObject({ stepId: 'commit', state: 'ok' });
  });

  it('lascia in corso un passo non ancora finito', () => {
    const items = buildTimeline({ ...run, events: run.events.slice(0, 2), prompts: [] });
    expect(items.at(-1)).toMatchObject({ kind: 'step', state: 'running' });
  });
});

describe('buildTimeline a run conclusa', () => {
  it('chiude le richieste rimaste aperte', () => {
    const items = buildTimeline({
      ...run,
      status: 'cancelled',
      prompts: [{ ...run.prompts[0]!, status: 'pending', answer: null }],
    });
    const prompt = items.find((i) => i.kind === 'prompt');
    expect(prompt?.kind === 'prompt' && prompt.record.status).toBe('superseded');
  });
});
