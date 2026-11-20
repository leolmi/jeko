import { appendFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunEvent } from '@jeko/shared';
import { describe, expect, it } from 'vitest';
import { Journals, RunJournal } from './journal.js';

const ev = (stepId: string): RunEvent => ({ runId: 'r1', type: 'step.skipped', stepId });

describe('giornale della run', () => {
  it('numera, conferma e si ricostruisce da disco', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jeko-journal-'));
    const j = new RunJournal(dir);
    expect([j.append(ev('a')).seq, j.append(ev('b')).seq, j.append(ev('c')).seq]).toEqual([
      1, 2, 3,
    ]);
    j.ack(1);

    const reopened = new RunJournal(dir);
    expect(reopened.lastSeq).toBe(3);
    expect(reopened.unacked().map((e) => e.seq)).toEqual([2, 3]);
    expect(reopened.append(ev('d')).seq).toBe(4);
  });

  it('scarta una riga troncata e continua da lì', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jeko-journal-'));
    const j = new RunJournal(dir);
    j.append(ev('a'));
    appendFileSync(join(dir, 'events.jsonl'), '{"seq":2,"event":{"ty');

    const reopened = new RunJournal(dir);
    expect(reopened.lastSeq).toBe(1);
    expect(reopened.append(ev('b')).seq).toBe(2);
    const lines = readFileSync(join(dir, 'events.jsonl'), 'utf8').trim().split('\n');
    expect(lines.map((l) => (JSON.parse(l) as { seq: number }).seq)).toEqual([1, 2]);
  });

  it('toglie la run chiusa quando il server ha tutto', () => {
    const journals = new Journals(mkdtempSync(join(tmpdir(), 'jeko-data-')));
    journals.append('r1', ev('a'));
    const { seq } = journals.append('r1', { runId: 'r1', type: 'run.finished', status: 'done' });
    expect(journals.runIds()).toEqual(['r1']);
    journals.dropIfSettled('r1');
    expect(journals.runIds()).toEqual(['r1']); // non ancora confermato
    journals.get('r1').ack(seq);
    journals.dropIfSettled('r1');
    expect(journals.runIds()).toEqual([]);
  });
});
