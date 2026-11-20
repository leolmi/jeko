import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import type { Check, SetupStatus } from '@jeko/shared';
import { firstValueFrom } from 'rxjs';

/** Verifiche lato server, nella stessa forma di quelle del runner. */
export function serverChecks(s: SetupStatus): Check[] {
  return [
    { id: 'server.api', ok: true, severity: 'error', detail: `v${s.server.version}` },
    { id: 'server.database', ok: s.server.database, severity: 'error' },
    {
      id: 'server.workflows',
      ok: s.server.workflows > 0,
      severity: 'warn',
      detail: String(s.server.workflows),
    },
  ];
}

export const INSTALLER_FILE = 'jeko-runner-install.ps1';
/** Comando per eseguire l'installer scaricato (PowerShell, dalla cartella Download). */
export const INSTALLER_CMD = `powershell -ExecutionPolicy Bypass -File "$env:USERPROFILE\\Downloads\\${INSTALLER_FILE}"`;

/** Si può proseguire se nessuna verifica bloccante è fallita. */
export const blocking = (checks: readonly Check[]) =>
  checks.some((c) => !c.ok && c.severity === 'error');

@Injectable({ providedIn: 'root' })
export class Setup {
  private readonly http = inject(HttpClient);
  readonly status = signal<SetupStatus | null>(null);
  /** L'ultimo tentativo di contattare il server è fallito. */
  readonly offline = signal(false);
  /** Primo avvio riaperto dall'app: si può chiudere senza rifarlo tutto. */
  readonly reopened = signal(false);

  async load(): Promise<SetupStatus | null> {
    try {
      const s = await firstValueFrom(this.http.get<SetupStatus>('/api/setup'));
      this.status.set(s);
      this.offline.set(false);
      return s;
    } catch {
      this.offline.set(true);
      return null;
    }
  }

  async recheck(): Promise<void> {
    try {
      await firstValueFrom(this.http.post('/api/setup/checks', {}));
    } catch {
      /* runner non collegato: lo dice già lo stato */
    }
  }

  /**
   * Scarica l'installer del runner. Ogni installer ha un token nuovo: quello precedente
   * smette di valere alla prossima connessione del runner.
   */
  async downloadInstaller(): Promise<void> {
    const blob = await firstValueFrom(
      this.http.post('/api/runner/installer', {}, { responseType: 'blob' }),
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = INSTALLER_FILE;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    this.status.update((s) => s && { ...s, runner: { ...s.runner, token: true } });
  }

  async complete(): Promise<void> {
    await firstValueFrom(this.http.post('/api/setup/complete', {}));
    this.reopened.set(false);
    this.status.update((s) => s && { ...s, completed: true });
  }

  /** Riapre il primo avvio (verifiche, runner, installer). */
  async reopen(): Promise<void> {
    await firstValueFrom(this.http.delete('/api/setup/complete'));
    this.reopened.set(true);
    this.status.update((s) => s && { ...s, completed: false });
  }
}
