import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { durableTurn, type DurableTurnOptions } from './turn.js';

const fake = fileURLToPath(new URL('./fixtures/fake-claude.mjs', import.meta.url));
let root: string;
let log: string;

const invocations = (): { args: string[]; stdin: string }[] => {
  try {
    return readFileSync(log, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { args: string[]; stdin: string });
  } catch {
    return [];
  }
};

const turn = (extra: Partial<DurableTurnOptions> = {}) =>
  durableTurn({
    dir: join(root, 'turn'),
    command: [process.execPath, fake],
    prompt: 'lavora',
    pollMs: 50,
    ...extra,
  });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jeko-turn-test-'));
  log = join(root, 'log.jsonl');
  process.env['FAKE_LOG'] = log;
  delete process.env['FAKE_SLEEP'];
  delete process.env['FAKE_DIE'];
  delete process.env['FAKE_LINGER'];
});

describe('turno di claude staccato', () => {
  it('esegue il turno e non lo ripete se richiesto di nuovo', async () => {
    const res = await turn();
    expect(res).toMatchObject({ ok: true, output: 'eco: lavora' });
    expect(invocations()[0]!.args).toContain('--session-id');
    expect(await turn()).toEqual(res);
    expect(invocations()).toHaveLength(1);
  });

  it("segnala l'attività di claude una volta sola", async () => {
    const seen: unknown[] = [];
    await turn({ onActivity: (a) => seen.push(a) });
    await turn({ onActivity: (a) => seen.push(a) });
    expect(seen).toEqual([
      { kind: 'text', text: 'Al lavoro' },
      { kind: 'tool', tool: 'Bash', text: 'npm test' },
    ]);
  });

  it('riprende la sessione della run con --resume', async () => {
    const res = await turn({ sessionId: 'sess-1' });
    expect(res.sessionId).toBe('sess-1');
    expect(invocations()[0]!.args).toEqual(expect.arrayContaining(['--resume', 'sess-1']));
  });

  it('se il processo muore senza risultato riprende la sessione', async () => {
    process.env['FAKE_DIE'] = '1';
    const res = await turn();
    expect(res.ok).toBe(true);
    const [first, second] = invocations();
    expect(first!.args).toContain('--session-id');
    expect(second!.args).toContain('--resume');
    expect(second!.stdin).toContain('si è interrotto');
  });

  it('un secondo runner riaggancia il processo ancora vivo', async () => {
    process.env['FAKE_SLEEP'] = '1500';
    const a = turn();
    await new Promise((r) => setTimeout(r, 400));
    const b = turn(); // come un runner riavviato: stessa cartella, processo vivo
    const [ra, rb] = await Promise.all([a, b]);
    expect(rb).toEqual(ra);
    expect(invocations()).toHaveLength(1);
  });

  it('se claude resta vivo dopo il risultato lo chiude e finisce il turno', async () => {
    process.env['FAKE_LINGER'] = '60000';
    const started = Date.now();
    const res = await turn({ resultGraceMs: 200 });
    expect(res).toMatchObject({ ok: true, output: 'eco: lavora' });
    expect(Date.now() - started).toBeLessThan(10000);
    expect(invocations()).toHaveLength(1);
  });

  it('annullando la run chiude il processo', async () => {
    process.env['FAKE_SLEEP'] = '10000';
    const controller = new AbortController();
    const started = Date.now();
    const p = turn({ signal: controller.signal });
    setTimeout(() => controller.abort(), 300);
    expect(await p).toEqual({ ok: false, output: 'Turno annullato' });
    expect(Date.now() - started).toBeLessThan(8000);
  });
});
