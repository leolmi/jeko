import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { run } from './spawn.js';

describe('spawn', () => {
  it('passa gli argomenti senza interpretarli', async () => {
    const tricky = 'a "b" & c | d %PATH% $HOME';
    const res = await run(['node', '-e', 'process.stdout.write(process.argv[1])', tricky]);
    expect(res).toMatchObject({ code: 0, stdout: tricky });
  });

  it('scrive stdin', async () => {
    const res = await run(['node', '-e', 'process.stdin.pipe(process.stdout)'], { stdin: 'ciao' });
    expect(res.stdout).toBe('ciao');
  });

  it.runIf(process.platform === 'win32')('lancia i .cmd con argomenti sicuri', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jeko-spawn-'));
    try {
      writeFileSync(
        join(dir, 'eco.cmd'),
        '@node -e "process.stdout.write(process.argv.slice(1).join(\'|\'))" %*\r\n',
      );
      const res = await run(['eco', 'x & y', 'a "b"', '100%'], { cwd: dir });
      expect(res).toMatchObject({ code: 0, stdout: 'x & y|a "b"|100%' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('riporta un comando inesistente', async () => {
    const res = await run(['comando-che-non-esiste-jeko']);
    expect(res.code).not.toBe(0);
  });
});
