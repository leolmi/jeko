import { spawn, type ChildProcess, type SpawnOptions } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Lancia un programma senza shell, passando gli argomenti così come sono.
 * Su Windows i .cmd/.bat (npm, npx, claude installato via npm…) richiedono cmd.exe:
 * in quel caso gli argomenti vengono quotati ed escapati come fa cross-spawn.
 */
export function spawnArgv(argv: string[], options: Omit<SpawnOptions, 'shell'> = {}): ChildProcess {
  const [command, ...args] = argv;
  if (!command) throw new Error('Comando vuoto');
  if (process.platform !== 'win32') return spawn(command, args, { ...options, shell: false });

  const env = options.env ?? process.env;
  const cwd = typeof options.cwd === 'string' ? options.cwd : process.cwd();
  const file = resolveWindows(command, cwd, env) ?? command;
  if (!/\.(cmd|bat)$/i.test(file)) return spawn(file, args, { ...options, shell: false });

  const double = /node_modules[\\/]\.bin[\\/][^\\/]+\.cmd$/i.test(file);
  const line = [
    escapeCommand(path.normalize(file)),
    ...args.map((a) => escapeArgument(a, double)),
  ].join(' ');
  return spawn(env['ComSpec'] ?? 'cmd.exe', ['/d', '/s', '/c', `"${line}"`], {
    ...options,
    shell: false,
    windowsVerbatimArguments: true,
  });
}

const META = /([()\][%!^"`<>&|;, *?])/g;

function escapeCommand(cmd: string): string {
  return cmd.replace(META, '^$1');
}

function escapeArgument(arg: string, double: boolean): string {
  let a = arg.replace(/(\\*)"/g, '$1$1\\"');
  a = a.replace(/(\\*)$/, '$1$1');
  a = `"${a}"`.replace(META, '^$1');
  return double ? a.replace(META, '^$1') : a;
}

function resolveWindows(cmd: string, cwd: string, env: NodeJS.ProcessEnv): string | null {
  const exts = (env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  const withExt = path.extname(cmd) ? [''] : exts;
  const isFile = (p: string) => existsSync(p) && statSync(p).isFile();

  if (cmd.includes('/') || cmd.includes('\\')) {
    const base = path.resolve(cwd, cmd);
    return withExt.map((e) => base + e).find(isFile) ?? null;
  }
  const dirs = [cwd, ...(env['PATH'] ?? env['Path'] ?? '').split(path.delimiter).filter(Boolean)];
  for (const dir of dirs) {
    for (const e of withExt) {
      const p = path.join(dir, cmd + e);
      if (isFile(p)) return p;
    }
  }
  return null;
}

export interface Collected {
  code: number;
  stdout: string;
  stderr: string;
}

/** Lancia e raccoglie l'output; `stdin` viene scritto e chiuso subito. */
export function run(
  argv: string[],
  options: Omit<SpawnOptions, 'shell' | 'stdio'> & { stdin?: string } = {},
): Promise<Collected> {
  const { stdin, ...rest } = options;
  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawnArgv(argv, {
        ...rest,
        stdio: [stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      });
    } catch (e) {
      resolve({ code: -1, stdout: '', stderr: e instanceof Error ? e.message : String(e) });
      return;
    }
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d: Buffer) => (stdout += d.toString()));
    child.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));
    child.on('error', (e) => resolve({ code: -1, stdout, stderr: stderr + e.message }));
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
    if (stdin !== undefined) child.stdin?.end(stdin);
  });
}
