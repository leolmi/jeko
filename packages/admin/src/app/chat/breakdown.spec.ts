import type { AgentUsage } from '@jeko/shared';
import { buildBreakdown } from './breakdown';
import type { TimelineItem } from './timeline';

const use = (tokens: number, costUsd?: number): AgentUsage => ({
  durationMs: 1000,
  inputTokens: tokens,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  turns: 1,
  ...(costUsd !== undefined && { costUsd }),
});
const step = (stepId: string, usage?: AgentUsage): TimelineItem => ({
  kind: 'step',
  key: `${stepId}-${Math.random()}`,
  stepId,
  title: stepId.toUpperCase(),
  state: 'ok',
  activity: [],
  at: '2026-01-01T10:00:00.000Z',
  ...(usage && { usage }),
});

describe('buildBreakdown', () => {
  it('somma i passi ripetuti e ordina per costo', () => {
    const b = buildBreakdown([
      step('piano', use(100, 0.1)),
      step('implementa', use(500, 0.5)),
      step('check'),
      step('implementa', use(200, 0.4)),
    ]);
    expect(b?.measure).toBe('cost');
    expect(b?.steps.map((s) => [s.stepId, s.runs])).toEqual([
      ['implementa', 2],
      ['piano', 1],
    ]);
    expect(b?.total).toBeCloseTo(1);
    expect(b?.steps[0]?.share).toBeCloseTo(0.9);
  });

  it('senza costo per tutti i passi usa i token', () => {
    const b = buildBreakdown([step('a', use(300, 0.1)), step('b', use(100))]);
    expect(b?.measure).toBe('tokens');
    expect(b?.steps[0]?.share).toBeCloseTo(0.75);
  });

  it('con un solo passo non c’è nulla da confrontare', () => {
    expect(buildBreakdown([step('diretto', use(100, 0.1))])).toBeNull();
  });
});
