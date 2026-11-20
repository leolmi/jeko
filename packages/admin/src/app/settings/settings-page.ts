import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { I18n } from '../core/i18n';
import { Setup } from '../core/setup';
import { Icon } from '../ui/icon';
import { UserSettings } from '../ui/user-settings';

/** Pagina Opzioni: le opzioni dell'utente, modificabili in ogni momento. */
@Component({
  selector: 'jk-settings-page',
  imports: [UserSettings, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full overflow-y-auto' },
  template: `
    <div class="mx-auto max-w-3xl px-6 py-10">
      <h1 class="text-2xl font-bold tracking-tight">{{ i18n.t('settings.title') }}</h1>
      <p class="mt-2 text-sm text-muted">{{ i18n.t('settings.body') }}</p>
      <div class="mt-8"><jk-user-settings /></div>

      <section class="mt-8 rounded-xl border border-line bg-surface p-4">
        <p class="text-sm font-medium">{{ i18n.t('setup.reopen') }}</p>
        <p class="mt-0.5 text-xs text-faint">{{ i18n.t('setup.reopen.hint') }}</p>
        <div class="mt-3 flex items-center gap-3">
          @if (error()) {
            <p class="text-sm text-red-600 dark:text-red-400">{{ i18n.t('tpl.error') }}</p>
          }
          <button
            type="button"
            class="jk-btn-outline ml-auto"
            [disabled]="busy()"
            (click)="reopen()"
          >
            <jk-icon name="history" [size]="16" /> {{ i18n.t('setup.reopen') }}
          </button>
        </div>
      </section>
    </div>
  `,
})
export class SettingsPage {
  protected readonly i18n = inject(I18n);
  private readonly setup = inject(Setup);
  protected readonly busy = signal(false);
  protected readonly error = signal(false);

  /** Torna al wizard del primo avvio: le opzioni e i dati restano. */
  protected reopen(): void {
    if (this.busy() || !globalThis.confirm(this.i18n.t('setup.reopen.confirm'))) return;
    this.busy.set(true);
    this.error.set(false);
    this.setup
      .reopen()
      .catch(() => this.error.set(true))
      .finally(() => this.busy.set(false));
  }
}
