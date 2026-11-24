import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { platformFor } from './index.js';
import { parsePsStart } from './posix.js';

describe('sistemi', () => {
  it('mette i dati nella cartella giusta per ogni sistema', () => {
    expect(platformFor('win32').dataHome({ LOCALAPPDATA: 'L' })).toBe('L');
    expect(platformFor('linux').dataHome({ XDG_DATA_HOME: '/x' })).toBe('/x');
    expect(platformFor('linux').dataHome({})).toBe(join(homedir(), '.local', 'share'));
    expect(platformFor('darwin').dataHome({})).toBe(
      join(homedir(), 'Library', 'Application Support'),
    );
  });

  it("chiama l'eseguibile dell'app jeko.exe o jeko", () => {
    expect(platformFor('win32').appBinary).toBe('jeko.exe');
    expect(platformFor('linux').appBinary).toBe('jeko');
    expect(platformFor('darwin').appEntries).toContain('jeko');
  });

  it('legge l’avvio di un processo da ps', () => {
    const t = parsePsStart('Tue Nov  4 10:00:00 2026\n');
    expect(t).toBe(new Date(2026, 10, 4, 10, 0, 0).getTime());
    expect(parsePsStart('')).toBeNull();
    expect(parsePsStart('boh')).toBeNull();
  });
});
