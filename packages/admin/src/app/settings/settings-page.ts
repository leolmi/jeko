import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { AppUpdate } from '../core/app-update';
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
        <div class="flex items-center gap-3">
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium">{{ i18n.t('update.title') }}</p>
            <p class="mt-0.5 text-xs text-faint">
              {{ i18n.t('update.current', { v: app()?.version ?? '' }) }}
              @if (update(); as u) {
                @if (u.error) {
                  ·
                  <span class="text-red-600 dark:text-red-400">{{
                    i18n.t('update.error', { e: u.error })
                  }}</span>
                } @else if (u.available) {
                  · {{ i18n.t('update.available', { v: u.latest ?? '' }) }}
                } @else {
                  · {{ i18n.t('update.none') }}
                }
              }
            </p>
          </div>
          @if (app()?.desktop) {
            <button
              type="button"
              class="jk-btn-outline shrink-0"
              [disabled]="updates.checking() || updates.installing()"
              (click)="updates.check()"
            >
              <jk-icon
                name="refresh"
                [size]="16"
                [class]="updates.checking() ? 'animate-spin' : ''"
              />
              {{ i18n.t('update.check') }}
            </button>
          }
        </div>
        @if (!app()?.desktop) {
          <p class="mt-2 text-xs text-faint">{{ i18n.t('update.desktopOnly') }}</p>
        } @else if (update()?.available) {
          <div class="mt-3 flex items-center gap-3">
            <p class="flex-1 text-xs text-faint">
              @if (update()?.blocked; as b) {
                {{ i18n.t(b === 'source' ? 'update.blocked.source' : 'update.blocked.readonly') }}
              } @else if ((app()?.active ?? 0) > 0) {
                {{ i18n.t('update.busy') }}
              } @else if (updates.error(); as e) {
                <span class="text-red-600 dark:text-red-400">{{ e }}</span>
              } @else {
                {{ i18n.t('update.hint') }}
              }
            </p>
            <button
              type="button"
              class="jk-btn-primary shrink-0"
              [disabled]="!canInstall() || updates.installing()"
              (click)="install()"
            >
              <jk-icon
                [name]="updates.installing() ? 'refresh' : 'download'"
                [size]="16"
                [class]="updates.installing() ? 'animate-spin' : ''"
              />
              {{
                i18n.t(updates.installing() ? 'update.installing' : 'update.install', {
                  v: update()?.latest ?? '',
                })
              }}
            </button>
          </div>
        }
      </section>

      <section class="mt-4 rounded-xl border border-line bg-surface p-4">
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
  protected readonly updates = inject(AppUpdate);
  protected readonly app = this.updates.info;
  protected readonly update = this.updates.update;
  protected readonly canInstall = this.updates.canInstall;
  protected readonly busy = signal(false);
  protected readonly error = signal(false);

  constructor() {
    void this.updates.load();
  }

  protected install(): void {
    const v = this.update()?.latest ?? '';
    if (!globalThis.confirm(this.i18n.t('update.confirm', { v }))) return;
    void this.updates.install();
  }

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
