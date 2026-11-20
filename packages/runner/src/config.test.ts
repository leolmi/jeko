import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('configurazione del runner', () => {
  it("legge config.json e lascia la precedenza all'ambiente", () => {
    const dir = mkdtempSync(join(tmpdir(), 'jeko-config-'));
    const home = join('h', 'me');
    const projectsDir = join(home, 'projects');
    expect(loadConfig(dir, {}, home)).toEqual({
      server: 'ws://127.0.0.1:4310/ws/runner',
      projectsDir,
    });

    writeFileSync(
      join(dir, 'config.json'),
      JSON.stringify({ server: 'ws://h/ws', token: 't1', projectsDir: 'D:/dev' }),
    );
    expect(loadConfig(dir, {}, home)).toEqual({
      server: 'ws://h/ws',
      token: 't1',
      projectsDir: 'D:/dev',
    });
    expect(
      loadConfig(
        dir,
        { JEKO_RUNNER_TOKEN: 't2', JEKO_SERVER_WS: 'ws://x', JEKO_PROJECTS_DIR: 'E:/p' },
        home,
      ),
    ).toEqual({ server: 'ws://x', token: 't2', projectsDir: 'E:/p' });

    writeFileSync(join(dir, 'config.json'), '{ rotto');
    expect(loadConfig(dir, {}, home)).toEqual({
      server: 'ws://127.0.0.1:4310/ws/runner',
      projectsDir,
    });
  });
});
