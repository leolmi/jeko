import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ContextExclusions } from '@jeko/shared';
import type { Activity, AgentDriver, TurnOutput, TurnPermissions } from './agents/driver.js';
import { writeAtomic } from './journal.js';
import { killTree, processAlive, sameProcess } from './process.js';
import { spawnArgv } from './spawn.js';

export interface DurableTurnOptions {
  /** Cartella del turno: richiesta, uscite e stato (`turn.json`). */
  dir: string;
  /** Agente del turno (nei test con uno script finto come comando). */
  agent: AgentDriver;
  prompt: string;
  cwd?: string | undefined;
  /** Sessione dei turni precedenti della run, da riprendere. */
  sessionId?: string | undefined;
  /**
   * Riparte da una copia di `sessionId` (`--fork-session`): vale per ogni avvio finché manca il
   * risultato, così una ripresa dopo un'interruzione copia di nuovo l'originale.
   */
  fork?: boolean | undefined;
  allowedTools?: string[] | undefined;
  /** Ragionamento e modello del passo (`--effort`, `--model`). */
  effort?: string | undefined;
  model?: string | undefined;
  /** Esclusioni dal contesto dell'agente, dal progetto. */
  exclude?: ContextExclusions | undefined;
  /** Collega il turno ai permessi di Jeko; `token` c'è quando si riaggancia un turno. */
  permissions?: ((dir: string, token?: string) => TurnPermissions) | undefined;
  signal?: AbortSignal | undefined;
  /** Avanzamento del turno (testo e strumenti), letto dall'uscita mentre l'agente lavora. */
  onActivity?: ((a: Activity) => void) | undefined;
  pollMs?: number;
  /**
   * Attesa dopo il risultato prima di chiudere l'agente: con task in background (server,
   * monitor) resterebbe vivo e il turno non finirebbe mai.
   */
  resultGraceMs?: number;
  /** Avvii al massimo: il primo più le riprese dopo un'interruzione. */
  maxAttempts?: number;
}

interface Attempt {
  n: number;
  pid?: number;
  startedAt: number;
}

interface TurnMeta {
  /** Assente finché l'agente che sceglie da sé la sessione non la dice nell'uscita. */
  sessionId?: string;
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
 * Un turno dell'agente che sopravvive al runner. Il processo parte staccato, con richiesta e
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
  const sessionId = o.sessionId ?? (o.agent.caps.ownSessionId ? randomUUID() : undefined);
  meta ??= {
    ...(sessionId !== undefined && { sessionId }),
    resumed: o.sessionId !== undefined,
    attempts: [],
  };
  if (perms) meta.token = perms.token;
  save(o.dir, meta);
  const maxAttempts = o.maxAttempts ?? 2;
  let checkedIdentity = false;
  const pump = (n: number) => {
    pumpActivity(o, meta, n);
    return o.agent.parseStream(read(files(o.dir, n).out)) !== null;
  };

  try {
    for (;;) {
      if (o.signal?.aborted) return { ok: false, output: 'Turno annullato' };
      const last = meta.attempts.at(-1);
      if (last) {
        pump(last.n);
        const out = o.agent.parseStream(read(files(o.dir, last.n).out));
        if (out) {
          const session = out.sessionId ?? meta.sessionId;
          meta.result = { ...out, ...(session !== undefined && { sessionId: session }) };
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
          return {
            ok: false,
            output: `Turno di ${o.agent.label} interrotto${err ? `:\n${err}` : ''}`,
          };
        }
      }

      const n = meta.attempts.length + 1;
      const f = files(o.dir, n);
      // Sessione scelta dall'agente: si cerca negli avvii precedenti, per riprenderla.
      for (const a of meta.attempts) {
        if (meta.sessionId !== undefined) break;
        const found = o.agent.sessionOf?.(read(files(o.dir, a.n).out));
        if (found) meta.sessionId = found;
      }
      const raw = (n > 1 ? RESUME_NOTE : '') + o.prompt;
      const prompt = o.agent.preparePrompt?.(raw) ?? raw;
      writeFileSync(f.prompt, prompt);
      const resume = meta.sessionId !== undefined && (n > 1 || meta.resumed);
      const child = spawnTurn(o, meta, prompt, resume, perms, f);
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
  prompt: string,
  resume: boolean,
  perms: TurnPermissions | undefined,
  f: ReturnType<typeof files>,
): ChildProcess {
  const stdin = openSync(f.prompt, 'r');
  const stdout = openSync(f.out, 'a');
  const stderr = openSync(f.err, 'a');
  try {
    const { args, env } = o.agent.turn({
      dir: o.dir,
      prompt,
      sessionId: meta.sessionId,
      resume,
      fork: o.fork,
      allowedTools: o.allowedTools,
      effort: o.effort,
      model: o.model,
      exclude: o.exclude,
      permissions: perms?.input,
    });
    const child = spawnArgv([...o.agent.command, ...args], {
      ...(o.cwd !== undefined && { cwd: o.cwd }),
      env: { ...process.env, ...env },
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

/**
 * `tick` aggiorna l'attività e dice se il risultato è arrivato; se dopo il risultato il processo
 * resta vivo oltre `resultGraceMs` (task in background), lo chiude. Restituisce il tick da usare.
 */
function lingerGuard(pid: number, o: DurableTurnOptions, tick: () => boolean): () => void {
  let resultAt: number | undefined;
  let killed = false;
  return () => {
    if (!tick() || killed) return;
    resultAt ??= Date.now();
    if (Date.now() - resultAt >= (o.resultGraceMs ?? 3000)) {
      killed = true;
      killTree(pid);
    }
  };
}

/** Attende la fine del processo avviato qui; annullando la run lo chiude. */
function waitChild(child: ChildProcess, o: DurableTurnOptions, tick: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.pid === undefined) return resolve();
    const onAbort = () => child.pid !== undefined && killTree(child.pid);
    const timer = setInterval(lingerGuard(child.pid, o, tick), o.pollMs ?? 500);
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
function waitPid(pid: number, o: DurableTurnOptions, tick: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    const guard = lingerGuard(pid, o, tick);
    const timer = setInterval(() => {
      guard();
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
    for (const a of o.agent.parseActivity(line)) o.onActivity(a);
  }
  meta.seen = { n, bytes: start + end + 1 };
  save(o.dir, meta);
}
