import { describe, expect, it } from 'vitest';
import { AnswerSchema, CreateProjectSchema, RunnerToServerSchema, validator } from './index.js';

describe('contratto', () => {
  it('valida CreateProject', () => {
    const v = validator(CreateProjectSchema);
    expect(v({ name: 'Jeko' })).toBe(true);
    expect(v({ name: '' })).toBe(false);
    expect(v({ name: 'x', extra: 1 })).toBe(false);
  });

  it('valida i messaggi del runner', () => {
    const v = validator(RunnerToServerSchema);
    expect(v({ type: 'hello', runnerId: 'pc', version: '0.1.0', activeRuns: [] })).toBe(true);
    expect(v({ type: 'run.prompt', runId: 'r', promptId: 'nope', prompt: {} })).toBe(false);
  });

  it('valida le risposte', () => {
    const v = validator(AnswerSchema);
    expect(v({ kind: 'approve', approved: true })).toBe(true);
    expect(v({ kind: 'review', ok: false, feedback: '' })).toBe(false);
  });
});
