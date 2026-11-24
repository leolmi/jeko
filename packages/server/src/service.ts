import { spawn } from 'node:child_process';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { linkPair } from '../../runner/src/link.js';
import { platform } from '../../runner/src/platform/index.js';
import { startRunner } from '../../runner/src/runner.js';
import { buildApp, type JekoApp } from './app.js';
import { defaultDataDir } from './data/files.js';
import { Lifecycle } from './desktop/lifecycle.js';
import {
  type NeutralinoInfo,
  NeutralinoLink,
  parseNeutralinoInfo,
  readNeutralinoStdin,
} from './desktop/neutralino.js';
import { Updater } from './desktop/updater.js';
import { parseTemplateFile, type TemplateFile } from './projects/templates.js';
import type { AppControl } from './routes/app.js';
import { VERSION } from './version.js';

declare const __JEKO_BUILTIN__: { workflows: string[]; templates: string[] } | undefined;

const here = dirname(fileURLToPath(import.meta.url));
/** Il servizio gira dal bundle (`<app>/server/jeko.js`) e non dai sorgenti. */
const bundled = basename(fileURLToPath(import.meta.url)) === 'jeko.js';
const UPDATE_REPO = process.env['JEKO_UPDATE_REPO'] ?? 'leolmi/jeko';
const UPDATE_EVERY_MS = 6 * 3600_000;

/** Workflow e template di serie: nel bundle sono dentro il file, in sviluppo in `shared/`. */
function builtins(): { workflows: string[]; templates: TemplateFile[] } {
  if (typeof __JEKO_BUILTIN__ !== 'undefined') {
    return {
      workflows: __JEKO_BUILTIN__.workflows,
      templates: __JEKO_BUILTIN__.templates.map(parseTemplateFile),
    };
  }
  const read = (dir: string, ext: string) => {
    const path = join(here, '..', '..', 'shared', dir);
    return readdirSync(path)
      .filter((f) => f.endsWith(ext))
      .sort()
      .map((f) => readFileSync(join(path, f), 'utf8'));
  };
  return {
    workflows: read('workflows', '.yaml'),
    templates: read('templates', '.md').map(parseTemplateFile),
  };
}

/** Build della web-app: accanto al bundle, o quella di `ng build` in sviluppo. */
function adminDir(): string | undefined {
  const dir = bundled
    ? join(here, 'admin')
    : join(here, '..', '..', 'admin', 'dist', 'admin', 'browser');
  return existsSync(join(dir, 'index.html')) ? dir : undefined;
}

/** Pagina remota del relay su questo PC: accanto al bundle, o `packages/relay/public`. */
function relayPublicDir(): string {
  return bundled ? join(here, 'relay') : join(here, '..', '..', 'relay', 'public');
}

/** Cartella dell'app (con `jeko.exe` o `jeko`), solo se il servizio gira dal bundle installato. */
function appDir(): string | null {
  const dir = dirname(here);
  return bundled && existsSync(join(dir, platform.appBinary)) ? dir : null;
}

/** Registro del servizio desktop (che non ha console): `%LOCALAPPDATA%\jeko\logs\jeko.log`. */
function logStream(dataDir: string): NodeJS.WritableStream {
  const dir = join(dataDir, '..', 'logs');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'jeko.log');
  if (existsSync(file) && statSync(file).size > 5 * 1024 * 1024) renameSync(file, `${file}.1`);
  return createWriteStream(file, { flags: 'a' });
}

/**
 * Avvio come estensione Neutralino: si stacca dalla finestra (così chiudendola il servizio
 * può finire i task) e passa al servizio i dati per collegarsi a Neutralino.
 */
export async function launchDesktop(): Promise<void> {
  const info = await readNeutralinoStdin();
  spawn(process.execPath, [fileURLToPath(import.meta.url)], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: { ...process.env, JEKO_NL: info ? JSON.stringify(info) : '{}' },
  }).unref();
  process.exit(0);
}

/** Passa al servizio già acceso i dati della finestra che ha avviato questo processo. */
async function handOverWindow(port: number): Promise<void> {
  const info = parseNeutralinoInfo(process.env['JEKO_NL']);
  if (!info) return;
  try {
    await fetch(`http://127.0.0.1:${port}/api/app/window`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(info),
    });
  } catch {
    /* un servizio di una versione precedente non lo sa fare: pazienza */
  }
}

async function isJeko(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    return ((await res.json()) as { app?: string }).app === 'jeko';
  } catch {
    return false;
  }
}

export async function runService({ desktop }: { desktop: boolean }): Promise<void> {
  const dataDir = defaultDataDir();
  mkdirSync(dataDir, { recursive: true });
  const port = Number(process.env['JEKO_PORT'] ?? process.env['PORT'] ?? 4310);
  const logger = desktop ? { level: 'info', stream: logStream(dataDir) } : true;

  // Jeko è già acceso (es. sta finendo dei task a finestra chiusa): la finestra usa quello,
  // che riceve i dati per collegarsi a lei (e chiuderla quando si riavvia).
  if (await isJeko(port)) {
    console.info(`Jeko è già attivo sulla porta ${port}`);
    if (desktop) await handOverWindow(port);
    process.exit(0);
  }

  let control: AppControl | undefined;
  let lifecycle: Lifecycle | undefined;
  // Assegnato dopo: le funzioni qui sotto (log, riavvio) lo usano solo più tardi.
  // eslint-disable-next-line prefer-const
  let app: JekoApp;
  let shutdown: () => Promise<void> = async () => {};
  let updater: Updater | undefined;
  if (desktop) {
    updater = new Updater({
      version: VERSION,
      appDir: appDir(),
      repo: UPDATE_REPO,
      log: { info: (m) => app.log.info(m), warn: (m) => app.log.warn(m) },
    });
    updater.cleanup();
    // Le finestre collegate: quella che ha avviato il servizio e quelle aperte dopo.
    const windows = new Set<NeutralinoLink>();
    const attachWindow = (info: NeutralinoInfo) => {
      const link = new NeutralinoLink(info, { warn: (m) => app.log.warn(m) });
      windows.add(link);
      link.connect();
      link.onClose(() => {
        windows.delete(link);
        app.log.info('finestra chiusa');
        lifecycle?.arm();
      });
    };
    control = {
      updater,
      restart: () => {
        updater!.relaunch();
        for (const w of windows) w.exit();
        void shutdown();
      },
      attachWindow,
    };
    const nl = parseNeutralinoInfo(process.env['JEKO_NL']);
    if (nl) attachWindow(nl);
  }

  app = await buildApp({
    dataDir,
    logger,
    adminDir: adminDir(),
    control,
    seed: builtins(),
    relay: { publicDir: relayPublicDir() },
  });
  try {
    await app.listen({ host: '127.0.0.1', port });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EADDRINUSE' && (await isJeko(port))) {
      app.log.info(`Jeko è già attivo sulla porta ${port}`);
      await app.close();
      process.exit(0);
    }
    throw e;
  }
  app.log.info(`Jeko ${VERSION}, dati in ${dataDir}`);

  const log =
    (level: 'info' | 'warn' | 'error') =>
    (msg: unknown, ...rest: unknown[]) =>
      app.log[level](rest.length ? { detail: rest.map(String) } : {}, String(msg));
  const runner = await startRunner({
    version: VERSION,
    connect: () => {
      const [server, client] = linkPair();
      app.jeko.hub.attachRunner(server);
      return client;
    },
    log: { info: log('info'), warn: log('warn'), error: log('error') },
  });

  await app.jeko.relay.sync();
  app.jeko.remote.start();

  let closing = false;
  shutdown = async () => {
    if (closing) return;
    closing = true;
    lifecycle?.stop();
    app.log.info('uscita');
    await runner.detach();
    await app.close();
    process.exit(0);
  };
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => void shutdown());

  if (desktop) {
    lifecycle = new Lifecycle({
      // Con dispositivi remoti confermati il servizio resta acceso, come con una finestra.
      windows: () => app.jeko.hub.adminCount + (app.jeko.remote.keepsAlive ? 1 : 0),
      activeRuns: () => app.jeko.runs.activeCount,
      onIdle: () => void shutdown(),
    });
    if (!process.env['JEKO_NL'] || process.env['JEKO_NL'] === '{}') lifecycle.arm();
    const check = () => void updater!.check();
    setTimeout(check, 5000).unref();
    setInterval(check, UPDATE_EVERY_MS).unref();
  }
}
