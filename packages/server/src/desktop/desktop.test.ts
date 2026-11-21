import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Lifecycle } from './lifecycle.js';
import { parseNeutralinoInfo } from './neutralino.js';
import { compareVersions, relaunchScript, replaceEntries, Updater } from './updater.js';

describe('vita del servizio desktop', () => {
  afterEach(() => vi.useRealTimers());

  const setup = (state: { windows: number; active: number }) => {
    vi.useFakeTimers();
    const onIdle = vi.fn();
    const life = new Lifecycle({
      windows: () => state.windows,
      activeRuns: () => state.active,
      onIdle,
      intervalMs: 100,
    });
    return { life, onIdle };
  };

  it('non esce finché la finestra non si è mai aperta', () => {
    const { onIdle } = setup({ windows: 0, active: 0 });
    vi.advanceTimersByTime(1000);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('chiusa la finestra, aspetta la fine dei task attivi', () => {
    const state = { windows: 1, active: 1 };
    const { onIdle } = setup(state);
    vi.advanceTimersByTime(200);
    state.windows = 0;
    vi.advanceTimersByTime(1000);
    expect(onIdle).not.toHaveBeenCalled();
    state.active = 0; // finito, o fermo a un gate
    vi.advanceTimersByTime(250);
    expect(onIdle).toHaveBeenCalledOnce();
  });

  it('una pagina che si ricarica non lo fa uscire', () => {
    const state = { windows: 1, active: 0 };
    const { onIdle } = setup(state);
    vi.advanceTimersByTime(100);
    state.windows = 0;
    vi.advanceTimersByTime(100);
    state.windows = 1;
    vi.advanceTimersByTime(500);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('esce subito se Neutralino si chiude prima della finestra', () => {
    const { life, onIdle } = setup({ windows: 0, active: 0 });
    life.arm();
    vi.advanceTimersByTime(250);
    expect(onIdle).toHaveBeenCalledOnce();
  });
});

describe('aggiornamento', () => {
  it('confronta le versioni', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('v1.2', '1.2.0')).toBe(0);
    expect(compareVersions('1.0.0', '1.0.1')).toBeLessThan(0);
  });

  it('sostituisce file e cartelle, tenendo i vecchi come .old', () => {
    const app = mkdtempSync(join(tmpdir(), 'jeko-app-'));
    const pkg = mkdtempSync(join(tmpdir(), 'jeko-pkg-'));
    writeFileSync(join(app, 'jeko.exe'), 'vecchio');
    mkdirSync(join(app, 'server', 'admin'), { recursive: true });
    writeFileSync(join(app, 'server', 'admin', 'main-old.js'), 'x');
    writeFileSync(join(pkg, 'jeko.exe'), 'nuovo');
    mkdirSync(join(pkg, 'server', 'admin'), { recursive: true });
    writeFileSync(join(pkg, 'server', 'jeko.js'), 'servizio');
    writeFileSync(join(pkg, 'server', 'admin', 'main-new.js'), 'y');

    replaceEntries(app, pkg, ['jeko.exe', 'resources.neu', 'server']);
    expect(readFileSync(join(app, 'jeko.exe'), 'utf8')).toBe('nuovo');
    expect(readFileSync(join(app, 'jeko.exe.old'), 'utf8')).toBe('vecchio');
    expect(existsSync(join(app, 'server', 'admin', 'main-old.js'))).toBe(false);
    expect(existsSync(join(app, 'server', 'admin', 'main-new.js'))).toBe(true);
    expect(existsSync(join(app, 'resources.neu'))).toBe(false);

    new Updater({ version: '1', appDir: app, repo: 'x/y', log: console }).cleanup();
    expect(existsSync(join(app, 'jeko.exe.old'))).toBe(false);
    expect(existsSync(join(app, 'server.old'))).toBe(false);
  });

  it('trova la release più nuova dal manifest', async () => {
    const fake = (async (url: string) => {
      if (url.includes('/releases/latest'))
        return Response.json({
          body: 'note',
          assets: [
            { name: 'manifest.json', browser_download_url: 'https://x/manifest.json' },
            { name: 'jeko-0.2.0-win-x64.zip', browser_download_url: 'https://x/zip' },
          ],
        });
      return Response.json({
        version: '0.2.0',
        package: { name: 'jeko-0.2.0-win-x64.zip', size: 1, sha256: 'x' },
      });
    }) as typeof fetch;
    const u = new Updater({
      version: '0.1.0',
      appDir: null,
      repo: 'x/y',
      log: console,
      fetch: fake,
    });
    expect(await u.check()).toMatchObject({
      current: '0.1.0',
      latest: '0.2.0',
      available: true,
      blocked: 'source',
      notes: 'note',
    });
    await expect(u.install()).rejects.toThrow();
  });

  it("legge i dati dell'estensione Neutralino", () => {
    expect(
      parseNeutralinoInfo(
        '{"nlPort":"5000","nlToken":"t","nlConnectToken":"c","nlExtensionId":"e"}',
      ),
    ).toEqual({ nlPort: '5000', nlToken: 't', nlConnectToken: 'c', nlExtensionId: 'e' });
    expect(parseNeutralinoInfo('{}')).toBeNull();
    expect(parseNeutralinoInfo('boh')).toBeNull();
  });
});

describe('riavvio dopo l’aggiornamento', () => {
  it('aspetta il servizio e riapre jeko.exe, con gli apici dei percorsi raddoppiati', () => {
    const dir = join('app', "d'Leo");
    const script = relaunchScript(42, dir);
    const q = (v: string) => `'${v.replaceAll("'", "''")}'`;
    expect(script).toContain('Wait-Process -Id 42 ');
    expect(script).toContain(
      `Start-Process -FilePath ${q(join(dir, 'jeko.exe'))} -WorkingDirectory ${q(dir)}`,
    );
    expect(script).toContain("d''Leo");
  });
});
