import { describe, expect, it } from 'vitest';
import {
  AnswerSchema,
  CreateProjectSchema,
  folderKey,
  RunnerToServerSchema,
  validator,
} from './index.js';

describe('contratto', () => {
  it('valida CreateProject', () => {
    const v = validator(CreateProjectSchema);
    expect(v({ name: 'Jeko', path: 'C:\\dev\\jeko' })).toBe(true);
    expect(v({ name: 'Jeko' })).toBe(false);
    expect(v({ name: '', path: 'x' })).toBe(false);
    expect(v({ name: 'x', path: 'x', extra: 1 })).toBe(false);
  });

  it('confronta le cartelle senza maiuscole né separatori', () => {
    expect(folderKey('C:\\Dev\\Jeko\\')).toBe(folderKey('c:/dev/jeko'));
    expect(folderKey('C:\\dev\\jeko')).not.toBe(folderKey('C:\\dev\\jeko2'));
    expect(folderKey('  ')).toBeNull();
    expect(folderKey(null)).toBeNull();
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
