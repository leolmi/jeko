import { spawnSync } from 'node:child_process';

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Istante di avvio di un processo (ms), se si riesce a leggerlo. */
export function processStart(pid: number): number | null {
  if (process.platform !== 'win32') return null;
  const res = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')`,
    ],
    { encoding: 'utf8', windowsHide: true, timeout: 10_000 },
  );
  const t = Date.parse(res.stdout.trim());
  return Number.isNaN(t) ? null : t;
}

/** È ancora il processo avviato a `startedAt`? Windows riusa i PID. */
export function sameProcess(pid: number, startedAt: number): boolean {
  if (!processAlive(pid)) return false;
  const start = processStart(pid);
  return start === null || Math.abs(start - startedAt) < 10_000;
}

/** Chiude il processo e i suoi figli (su Windows i figli non muoiono con il padre). */
export function killTree(pid: number): void {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    // già terminato
  }
}
