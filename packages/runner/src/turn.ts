import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  claudeArgs,
  parseActivity,
  parseStream,
  settingsWithPlugins,
  type Activity,
  type TurnInput,
  type TurnOutput,
} from './claude.js';
import type { ContextExclusions } from '@jeko/shared';
import { writeAtomic } from './journal.js';
import { killTree, processAlive, sameProcess } from './process.js';
import { spawnArgv } from './spawn.js';

/** Permessi di un turno: configurazione per claude e token da ritrovare dopo un riavvio. */
export interface TurnPermissions {
  input: Pick<TurnInput, 'mcpConfig' | 'permissionPromptTool' | 'settings' | 'env'>;
  token: string;
  dispose: () => void;
}

export interface DurableTurnOptions {
  /** Cartella del turno: richiesta, uscite e stato (`turn.json`). */
  dir: string;
  /** Comando di claude (di solito `[claude]`; nei test uno script finto). */
  command: string[];
  prompt: string;
  cwd?: string | undefined;
  /** Sessione dei turni precedenti della run, da riprendere. */
  sessionId?: string | undefined;
  allowedTools?: string[] | undefined;
  /** Ragionamento e modello del passo (`--effort`, `--model`). */
  effort?: string | undefined;
  model?: string | undefined;
  /** Esclusioni dal contesto di claude, dal progetto. */
  exclude?: ContextExclusions | undefined;
  /** Collega il turno ai permessi di Jeko; `token` c'è quando si riaggancia un turno. */
  permissions?: ((dir: string, token?: string) => TurnPermissions) | undefined;
  signal?: AbortSignal | undefined;
  /** Avanzamento del turno (testo e strumenti), letto dall'uscita mentre claude lavora. */
  onActivity?: ((a: Activity) => void) | undefined;
  pollMs?: number;
  /** Avvii al massimo: il primo più le riprese dopo un'interruzione. */
  maxAttempts?: number;
}

interface Attempt {
  n: number;
  pid?: number;
  startedAt: number;
}

interface TurnMeta {
  sessionId: string;
  /** La sessione esisteva già prima di questo turno. */
  resumed: boolean;
  token?: string;
  attempts: Attempt[];
  /** Uscita già trasformata in attività: avvio e byte letti (per non ripeterle dopo un riavvio). */
  seen?: { n: number; bytes: number };
  result?: TurnOutput;
}

const META = 'turn.json';
const RESUME_NOTE =
  'Il turno precedente si è interrotto (riavvio del PC o del runner). ' +
  'Controlla lo stato del lavoro e riprendi da dove eri rimasto.\n\n';

const files = (dir: string, n: number) => ({
  prompt: join(dir, `prompt-${n}.txt`),
  out: join(dir, `out-${n}.jsonl`),
  err: join(dir, `err-${n}.log`),
});

function load(dir: string): TurnMeta | null {
  try {
    return JSON.parse(readFileSync(join(dir, META), 'utf8')) as TurnMeta;
  } catch {
    return null;
  }
}

const save = (dir: string, meta: TurnMeta) => writeAtomic(join(dir, META), JSON.stringify(meta));
const read = (file: string) => (existsSync(file) ? readFileSync(file, 'utf8') : '');

function tail(file: string): string {
  return read(file).trim().split('\n').slice(-10).join('\n');
}

/**
 * Un turno di claude che sopravvive al runner. Il processo parte staccato, con richiesta e
 * uscita su file; lo stato in `turn.json` permette a un runner riavviato di:
 * - restituire il risultato di un turno già finito, senza rieseguirlo;
 * - riagganciare il processo ancora vivo e attenderne la fine;
 * - riprendere la sessione (`--resume`) se il processo è morto senza risultato.
 */
export async function durableTurn(o: DurableTurnOptions): Promise<TurnOutput> {
  mkdirSync(o.dir, { recursive: true });
  let meta = load(o.dir);
  if (meta?.result) return meta.result;

  const perms = o.permissions?.(o.dir, meta?.token);
  meta ??= {
    sessionId: o.sessionId ?? randomUUID(),
    resumed: o.sessionId !== undefined,
    attempts: [],
  };
  if (perms) meta.token = perms.token;
  save(o.dir, meta);
  const maxAttempts = o.maxAttempts ?? 2;
  let checkedIdentity = false;
  const pump = (n: number) => pumpActivity(o, meta, n);

  try {
    for (;;) {
      if (o.signal?.aborted) return { ok: false, output: 'Turno annullato' };
      const last = meta.attempts.at(-1);
      if (last) {
        pump(last.n);
        const out = parseStream(read(files(o.dir, last.n).out));
        if (out) {
          meta.result = { ...out, sessionId: out.sessionId ?? meta.sessionId };
          save(o.dir, meta);
          return meta.result;
        }
        // Il processo di un runner precedente: si riaggancia solo se è davvero lui.
        const alive =
          last.pid !== undefined &&
          (checkedIdentity ? processAlive(last.pid) : sameProcess(last.pid, last.startedAt));
        checkedIdentity = true;
        if (alive) {
          await waitPid(last.pid!, o, () => pump(last.n));
          continue;
        }
        if (meta.attempts.length >= maxAttempts) {
          const err = tail(files(o.dir, last.n).err);
          return { ok: false, output: `Turno di claude interrotto${err ? `:\n${err}` : ''}` };
        }
      }

      const n = meta.attempts.length + 1;
      const f = files(o.dir, n);
      writeFileSync(f.prompt, (n > 1 ? RESUME_NOTE : '') + o.prompt);
      const child = spawnTurn(o, meta, n > 1 || meta.resumed, perms, f);
      meta.attempts.push({
        n,
        ...(child.pid !== undefined && { pid: child.pid }),
        startedAt: Date.now(),
      });
      save(o.dir, meta);
      checkedIdentity = true;
      await waitChild(child, o, () => pump(n));
    }
  } finally {
    perms?.dispose();
  }
}

function spawnTurn(
  o: DurableTurnOptions,
  meta: TurnMeta,
  resume: boolean,
  perms: TurnPermissions | undefined,
  f: ReturnType<typeof files>,
): ChildProcess {
  const stdin = openSync(f.prompt, 'r');
  const stdout = openSync(f.out, 'a');
  const stderr = openSync(f.err, 'a');
  try {
    const args = claudeArgs({
      sessionId: meta.sessionId,
      resume,
      allowedTools: o.allowedTools,
      effort: o.effort,
      model: o.model,
      ...perms?.input,
      settings: excludePlugins(perms?.input.settings, o),
      exclude: o.exclude,
    });
    const child = spawnArgv([...o.command, ...args], {
      ...(o.cwd !== undefined && { cwd: o.cwd }),
      env: { ...process.env, ...perms?.input.env },
      stdio: [stdin, stdout, stderr],
      detached: true,
      windowsHide: true,
    });
    child.on('error', (e) => writeFileSync(f.err, `${e.message}\n`, { flag: 'a' }));
    child.unref();
    return child;
  } finally {
    closeSync(stdin);
    closeSync(stdout);
    closeSync(stderr);
  }
}

/** Attende la fine del processo avviato qui; annullando la run lo chiude. */
function waitChild(child: ChildProcess, o: DurableTurnOptions, tick: () => void): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.pid === undefined) return resolve();
    const onAbort = () => child.pid !== undefined && killTree(child.pid);
    const timer = setInterval(tick, o.pollMs ?? 500);
    const done = () => {
      clearInterval(timer);
      o.signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    o.signal?.addEventListener('abort', onAbort, { once: true });
    child.once('close', done);
    child.once('error', done);
  });
}

/** Attende la fine di un processo riagganciato (non figlio di questo runner). */
function waitPid(pid: number, o: DurableTurnOptions, tick: () => void): Promise<void> {
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      tick();
      if (o.signal?.aborted) killTree(pid);
      if (!processAlive(pid)) {
        clearInterval(timer);
        resolve();
      }
    }, o.pollMs ?? 500);
  });
}

/** Legge le righe nuove e complete dell'uscita di un avvio e ne segnala le attività. */
function pumpActivity(o: DurableTurnOptions, meta: TurnMeta, n: number): void {
  if (!o.onActivity) return;
  const file = files(o.dir, n).out;
  if (!existsSync(file)) return;
  const start = meta.seen?.n === n ? meta.seen.bytes : 0;
  const buf = readFileSync(file).subarray(start);
  const end = buf.lastIndexOf(0x0a);
  if (end < 0) return;
  for (const line of buf.subarray(0, end).toString('utf8').split('\n')) {
    for (const a of parseActivity(line)) o.onActivity(a);
  }
  meta.seen = { n, bytes: start + end + 1 };
  save(o.dir, meta);
}

/** File di impostazioni del turno con i plugin esclusi; senza esclusioni quello dei permessi. */
function excludePlugins(settings: string | undefined, o: DurableTurnOptions): string | undefined {
  const plugins = o.exclude?.plugins ?? [];
  if (!plugins.length) return settings;
  const base = settings
    ? (JSON.parse(readFileSync(settings, 'utf8')) as Record<string, unknown>)
    : {};
  const file = join(o.dir, 'settings.exclude.json');
  writeFileSync(file, JSON.stringify(settingsWithPlugins(base, plugins)));
  return file;
}
