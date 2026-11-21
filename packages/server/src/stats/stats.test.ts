import type { AgentUsage, Project, RunDetail } from '@jeko/shared';
import { describe, expect, it } from 'vitest';
import { computeStats } from './stats.js';

const use = (tokens: number, costUsd: number): AgentUsage => ({
  durationMs: 1000,
  inputTokens: tokens,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd,
  turns: 1,
});

const now = new Date(2026, 10, 21, 12);
const at = (daysAgo: number) => new Date(2026, 10, 21 - daysAgo, 10).toISOString();

const project: Project = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'jeko',
  path: 'C:/Leo/Jeko/',
  workflow: null,
  createdAt: at(30),
};

let n = 0;
const run = (over: Partial<RunDetail>): RunDetail => ({
  id: `r${n++}`,
  workflow: 'sviluppo',
  version: 1,
  request: 'x',
  mode: 'checkpoint',
  status: 'done',
  error: null,
  cwd: 'c:/leo/jeko',
  usage: null,
  createdAt: at(0),
  updatedAt: at(0),
  events: [],
  prompts: [],
  ...over,
});

const step = (stepId: string, title: string, usage: AgentUsage, seq: number) => [
  { seq, at: at(0), event: { runId: 'r', type: 'step.started' as const, stepId, index: 0, title } },
  {
    seq: seq + 1,
    at: at(0),
    event: { runId: 'r', type: 'step.finished' as const, stepId, ok: true, output: '', usage },
  },
];

describe('computeStats', () => {
  const runs = [
    run({
      usage: use(300, 3),
      events: [...step('piano', 'Piano', use(100, 1), 1), ...step('fai', 'Fai', use(200, 2), 3)],
    }),
    run({ workflow: 'diretto', usage: use(50, 0.5), createdAt: at(1) }),
    run({ status: 'failed', cwd: 'D:/altro', usage: use(10, 0.1), createdAt: at(10) }),
  ];

  it('somma totali, modalità, progetti e passi', () => {
    const s = computeStats(runs, [project], { now });
    expect(s.totals.runs).toBe(3);
    expect(s.totals.byStatus).toEqual({ done: 2, failed: 1 });
    expect(s.totals.plan).toMatchObject({ runs: 2, tokens: 310 });
    expect(s.totals.direct).toMatchObject({ runs: 1, costUsd: 0.5 });
    expect(s.projects.map((p) => [p.name, p.runs, p.failed])).toEqual([
      ['jeko', 2, 0],
      ['', 1, 1],
    ]);
    expect(s.steps.map((x) => [x.title, x.usage.costUsd])).toEqual([
      ['Fai', 2],
      ['Piano', 1],
    ]);
    expect(s.days).toHaveLength(11);
    expect(s.days.at(-1)?.plan.runs).toBe(1);
  });

  it('filtra per progetto e per periodo', () => {
    const s = computeStats(runs, [project], { now, project, days: 7 });
    expect(s.totals.runs).toBe(2);
    expect(s.from).toBe('2026-11-15');
    expect(s.days).toHaveLength(7);
  });
});
