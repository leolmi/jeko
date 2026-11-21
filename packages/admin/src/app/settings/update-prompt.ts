import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { AppUpdate } from '../core/app-update';
import { I18n } from '../core/i18n';
import { storage } from '../core/storage';
import { Icon } from '../ui/icon';

/** Pausa dopo l'avvio prima di cercare aggiornamenti: prima si apre l'app. */
const STARTUP_DELAY_MS = 3000;
/** Versione che l'utente ha scelto di saltare: all'avvio non si propone più. */
const SKIPPED_KEY = 'update.skipped';

/**
 * All'avvio dell'app desktop cerca una versione nuova e, se c'è (e non è stata saltata),
 * la propone in un popup: installa, più tardi o salta questa versione.
 */
@Component({
  selector: 'jk-update-prompt',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'later()' },
  template: `
    @if (shown() && update(); as u) {
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="jk-update-title"
          class="w-full max-w-lg rounded-xl border border-line bg-surface p-5 shadow-xl"
        >
          <h2 id="jk-update-title" class="text-lg font-semibold">
            {{ i18n.t('update.prompt.title') }}
          </h2>
          <p class="mt-1 text-sm text-muted">
            {{ i18n.t('update.prompt.body', { v: u.latest ?? '', current: u.current }) }}
          </p>
          @if (u.notes) {
            <div
              class="mt-3 max-h-48 overflow-auto rounded-lg bg-subtle px-3 py-2 text-xs whitespace-pre-wrap"
              [textContent]="u.notes.trim()"
            ></div>
          }
          @if (!u.blocked && (updates.info()?.active ?? 0) > 0) {
            <p
              class="mt-3 flex items-start gap-2 rounded-lg border border-amber-400/60 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
              role="status"
            >
              <jk-icon name="warning" [size]="16" class="mt-0.5 shrink-0 text-amber-500" />
              {{ i18n.t('update.busy', { n: updates.info()?.active ?? 0 }) }}
            </p>
          } @else {
            <p class="mt-3 text-xs text-faint">
              @if (u.blocked; as b) {
                {{ i18n.t(b === 'source' ? 'update.blocked.source' : 'update.blocked.readonly') }}
              } @else if (updates.error(); as e) {
                <span class="text-red-600 dark:text-red-400">{{ e }}</span>
              } @else {
                {{ i18n.t('update.hint') }}
              }
            </p>
          }
          <div class="mt-4 flex flex-wrap justify-end gap-2">
            <button type="button" class="jk-btn-ghost" (click)="skip()">
              {{ i18n.t('update.skip') }}
            </button>
            <button type="button" class="jk-btn-outline" (click)="later()">
              {{ i18n.t('update.later') }}
            </button>
            <button
              type="button"
              class="jk-btn-primary"
              [disabled]="!updates.canInstall() || updates.installing()"
              (click)="updates.install()"
            >
              <jk-icon
                [name]="updates.installing() ? 'refresh' : 'download'"
                [size]="16"
                [class]="updates.installing() ? 'animate-spin' : ''"
              />
              {{
                i18n.t(updates.installing() ? 'update.installing' : 'update.install', {
                  v: u.latest ?? '',
                })
              }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class UpdatePrompt {
  protected readonly i18n = inject(I18n);
  protected readonly updates = inject(AppUpdate);
  protected readonly shown = signal(false);
  protected readonly update = this.updates.update;

  constructor() {
    setTimeout(() => void this.offer(), STARTUP_DELAY_MS);
  }

  private async offer(): Promise<void> {
    const info = await this.updates.load();
    if (!info?.desktop) return;
    await this.updates.check();
    const u = this.updates.update();
    if (u?.available && u.latest && storage.get(SKIPPED_KEY) !== u.latest) this.shown.set(true);
  }

  protected later(): void {
    if (!this.updates.installing()) this.shown.set(false);
  }

  protected skip(): void {
    const v = this.updates.update()?.latest;
    if (v) storage.set(SKIPPED_KEY, v);
    this.shown.set(false);
  }
}
