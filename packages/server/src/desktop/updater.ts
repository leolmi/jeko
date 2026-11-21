import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  accessSync,
  constants,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { UpdateInfo } from '@jeko/shared';

const run = promisify(execFile);

/** `release/manifest.json`, pubblicato con ogni release GitHub (`npm run release`). */
export interface Manifest {
  version: string;
  package: { name: string; size: number; sha256: string };
}

/** Cosa si sostituisce nella cartella dell'app: l'exe, le risorse della finestra, il servizio. */
export const APP_ENTRIES = ['jeko.exe', 'resources.neu', 'server'] as const;

export function compareVersions(a: string, b: string): number {
  const [pa, pb] = [a, b].map((v) => v.replace(/^v/, '').split('.').map(Number));
  for (let i = 0; i < Math.max(pa!.length, pb!.length); i++) {
    const d = (pa![i] ?? 0) - (pb![i] ?? 0);
    if (d) return d;
  }
  return 0;
}

export interface UpdaterOptions {
  version: string;
  /** Cartella dell'app (con `jeko.exe`); null se il servizio gira dai sorgenti. */
  appDir: string | null;
  /** Repository GitHub delle release, `proprietario/nome`. */
  repo: string;
  log: { info(msg: string): void; warn(msg: string): void };
  fetch?: typeof fetch;
}

/**
 * Aggiornamento automatico dalle release GitHub: un solo pacchetto (zip) con exe, risorse
 * della finestra e bundle del servizio. I file in uso non si possono sovrascrivere ma si
 * possono rinominare: i vecchi diventano `*.old` e si cancellano all'avvio successivo.
 */
export class Updater {
  private last: UpdateInfo | null = null;
  private latestManifest: { manifest: Manifest; url: string } | null = null;
  private busy = false;
  private readonly fetch: typeof fetch;

  constructor(private readonly opts: UpdaterOptions) {
    this.fetch = opts.fetch ?? fetch;
  }

  get info(): UpdateInfo | null {
    return this.last;
  }

  /** Perché non si può installare, o null. */
  blocker(): UpdateInfo['blocked'] {
    const dir = this.opts.appDir;
    if (!dir) return 'source';
    try {
      accessSync(dir, constants.W_OK);
      return null;
    } catch {
      return 'readonly';
    }
  }

  async check(): Promise<UpdateInfo> {
    const base: UpdateInfo = {
      current: this.opts.version,
      latest: null,
      available: false,
      blocked: this.blocker(),
      checkedAt: new Date().toISOString(),
    };
    try {
      const headers = { 'user-agent': 'jeko-updater', accept: 'application/vnd.github+json' };
      const res = await this.fetch(
        `https://api.github.com/repos/${this.opts.repo}/releases/latest`,
        { headers },
      );
      if (res.status === 404) return (this.last = base); // nessuna release
      if (!res.ok) throw new Error(`GitHub ha risposto ${res.status}`);
      const release = (await res.json()) as {
        body?: string;
        assets?: { name: string; browser_download_url: string }[];
      };
      const asset = (name: string) => release.assets?.find((a) => a.name === name);
      const m = asset('manifest.json');
      if (!m) throw new Error('La release non ha manifest.json');
      const manifest = (await (
        await this.fetch(m.browser_download_url, { headers })
      ).json()) as Manifest;
      const zip = asset(manifest.package.name);
      if (!zip) throw new Error(`La release non ha ${manifest.package.name}`);
      this.latestManifest = { manifest, url: zip.browser_download_url };
      this.last = {
        ...base,
        latest: manifest.version,
        available: compareVersions(manifest.version, this.opts.version) > 0,
        ...(release.body && { notes: release.body }),
      };
    } catch (e) {
      this.last = { ...base, error: e instanceof Error ? e.message : String(e) };
    }
    return this.last;
  }

  /**
   * Scarica, verifica e mette al loro posto i file della nuova versione. Dopo, l'app va
   * riavviata (`relaunch`). In caso di errore rimette i file di prima.
   */
  async install(): Promise<void> {
    if (this.busy) throw new Error('Aggiornamento già in corso');
    const appDir = this.opts.appDir;
    if (!appDir || this.blocker()) throw new Error('Aggiornamento non possibile da qui');
    this.busy = true;
    try {
      if (!this.latestManifest || !this.last?.available) await this.check();
      const latest = this.latestManifest;
      if (!latest || !this.last?.available) throw new Error('Nessun aggiornamento disponibile');
      const work = join(tmpdir(), 'jeko-update');
      rmSync(work, { recursive: true, force: true });
      mkdirSync(join(work, 'files'), { recursive: true });

      this.opts.log.info(`scarico ${latest.manifest.package.name}`);
      const res = await this.fetch(latest.url, { headers: { 'user-agent': 'jeko-updater' } });
      if (!res.ok) throw new Error(`Download non riuscito (${res.status})`);
      const data = Buffer.from(await res.arrayBuffer());
      const hash = createHash('sha256').update(data).digest('hex');
      if (hash !== latest.manifest.package.sha256) throw new Error('Pacchetto rovinato (SHA-256)');
      const zip = join(work, latest.manifest.package.name);
      writeFileSync(zip, data);
      // tar.exe di Windows (10 e successivi) apre anche gli zip; quello di Git, se nel PATH, no.
      const tar = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'tar.exe');
      await run(tar, ['-xf', zip, '-C', join(work, 'files')], { windowsHide: true });
      const files = join(work, 'files');
      for (const e of ['jeko.exe', join('server', 'jeko.js')])
        if (!existsSync(join(files, e))) throw new Error(`Pacchetto incompleto: manca ${e}`);

      replaceEntries(appDir, files, APP_ENTRIES);
      this.opts.log.info(`installata la versione ${latest.manifest.version}`);
    } finally {
      this.busy = false;
    }
  }

  /** Riapre l'app appena questo processo è uscito. */
  relaunch(): void {
    const appDir = this.opts.appDir;
    if (!appDir) return;
    const exe = join(appDir, 'jeko.exe').replaceAll("'", "''");
    const script = `Wait-Process -Id ${process.pid} -Timeout 120 -ErrorAction SilentlyContinue; Start-Process -FilePath '${exe}' -WorkingDirectory '${appDir.replaceAll("'", "''")}'`;
    spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
  }

  /** Toglie i `*.old` lasciati dall'ultimo aggiornamento (quelli ancora in uso restano). */
  cleanup(): void {
    const dir = this.opts.appDir;
    if (!dir || !existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.old')) continue;
      try {
        rmSync(join(dir, name), { recursive: true, force: true });
      } catch {
        /* ancora in uso: alla prossima */
      }
    }
  }
}

/**
 * Sostituisce in `target` le voci date con quelle di `source`: la vecchia diventa `<voce>.old`
 * (si rinomina anche un exe in uso), poi si copia la nuova. Al primo errore si torna indietro.
 */
export function replaceEntries(target: string, source: string, entries: readonly string[]): void {
  const done: { entry: string; hadOld: boolean }[] = [];
  try {
    for (const entry of entries) {
      const from = join(source, entry);
      if (!existsSync(from)) continue;
      const to = join(target, entry);
      const old = `${to}.old`;
      rmSync(old, { recursive: true, force: true });
      const hadOld = existsSync(to);
      if (hadOld) renameSync(to, old);
      done.push({ entry, hadOld });
      cpSync(from, to, { recursive: true });
    }
  } catch (e) {
    for (const { entry, hadOld } of done.reverse()) {
      const to = join(target, entry);
      try {
        rmSync(to, { recursive: true, force: true });
        if (hadOld) renameSync(`${to}.old`, to);
      } catch {
        /* si prova con le altre */
      }
    }
    throw e;
  }
}
