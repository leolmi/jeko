import { platform } from './platform/index.js';

export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Istante di avvio di un processo (ms), se si riesce a leggerlo. */
export const processStart = (pid: number): number | null => platform.processStart(pid);

/** È ancora il processo avviato a `startedAt`? I sistemi riusano i PID. */
export function sameProcess(pid: number, startedAt: number): boolean {
  if (!processAlive(pid)) return false;
  const start = processStart(pid);
  return start === null || Math.abs(start - startedAt) < 10_000;
}

/** Chiude il processo e i suoi figli (su Windows i figli non muoiono con il padre). */
export const killTree = (pid: number): void => platform.killTree(pid);
