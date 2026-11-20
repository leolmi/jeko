import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('configurazione del runner', () => {
  it("legge config.json e lascia la precedenza all'ambiente", () => {
    const dir = mkdtempSync(join(tmpdir(), 'jeko-config-'));
    expect(loadConfig(dir, {})).toEqual({ server: 'ws://127.0.0.1:4310/ws/runner' });

    writeFileSync(join(dir, 'config.json'), JSON.stringify({ server: 'ws://h/ws', token: 't1' }));
    expect(loadConfig(dir, {})).toEqual({ server: 'ws://h/ws', token: 't1' });
    expect(loadConfig(dir, { JEKO_RUNNER_TOKEN: 't2', JEKO_SERVER_WS: 'ws://x' })).toEqual({
      server: 'ws://x',
      token: 't2',
    });

    writeFileSync(join(dir, 'config.json'), '{ rotto');
    expect(loadConfig(dir, {})).toEqual({ server: 'ws://127.0.0.1:4310/ws/runner' });
  });
});
