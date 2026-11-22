import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { processAlive } from './process.js';
import { ProcessRegistry } from './processes.js';

const node = `"${process.execPath}"`;
const waitFor = async (cond: () => boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
  return cond();
};

describe('processi lasciati attivi dopo il turno', () => {
  it('avvia staccato, registra e alla fine della run chiude ciò che è vivo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jeko-proc-'));
    const reg = new ProcessRegistry(dir, 500);
    const cwd = mkdtempSync(join(tmpdir(), 'jeko-cwd-'));

    const alive = await reg.start('run-1', {
      command: `${node} -e "console.log('in ascolto'); setInterval(() => {}, 1000)"`,
      cwd,
    });
    expect(alive.running).toBe(true);
    expect(alive.output).toContain('in ascolto');
    expect(processAlive(alive.pid)).toBe(true);

    const quick = await reg.start('run-1', { command: `${node} -e "process.exit(3)"`, cwd });
    expect(quick).toMatchObject({ running: false, exitCode: 3 });
    expect(reg.list('run-1').map((e) => e.pid)).toEqual([alive.pid, quick.pid]);

    // Un'altra run non tocca questi processi.
    reg.stopRun('run-2');
    expect(processAlive(alive.pid)).toBe(true);
    expect(reg.status('run-1').map((p) => [p.pid, p.alive])).toEqual([
      [alive.pid, true],
      [quick.pid, false],
    ]);

    reg.stopRun('run-1');
    expect(await waitFor(() => !processAlive(alive.pid))).toBe(true);
    expect(existsSync(join(dir, 'run-1'))).toBe(false);
  }, 30_000);

  it('a task aperto chiude i processi vivi e ne tiene il registro', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jeko-proc-'));
    const reg = new ProcessRegistry(dir, 300);
    const p = await reg.start('run', {
      command: `${node} -e "setInterval(() => {}, 1000)"`,
      cwd: tmpdir(),
    });
    expect(reg.stop('run')).toMatchObject([{ pid: p.pid, alive: false }]);
    expect(await waitFor(() => !processAlive(p.pid))).toBe(true);
    expect(reg.status('run')).toMatchObject([{ pid: p.pid, alive: false }]);
    expect(existsSync(join(dir, 'run'))).toBe(true);
    reg.stopRun('run');
  }, 30_000);

  it('una cartella inesistente fa fallire l’avvio', async () => {
    const reg = new ProcessRegistry(mkdtempSync(join(tmpdir(), 'jeko-proc-')), 100);
    await expect(
      reg.start('r', { command: `${node} -e "1"`, cwd: join(tmpdir(), 'non-esiste-jeko') }),
    ).rejects.toThrow();
  });
});
