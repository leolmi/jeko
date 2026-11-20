import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { I18n } from '../core/i18n';
import { UserSettings } from '../ui/user-settings';

/** Pagina Opzioni: le opzioni dell'utente, modificabili in ogni momento. */
@Component({
  selector: 'jk-settings-page',
  imports: [UserSettings],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full overflow-y-auto' },
  template: `
    <div class="mx-auto max-w-3xl px-6 py-10">
      <h1 class="text-2xl font-bold tracking-tight">{{ i18n.t('settings.title') }}</h1>
      <p class="mt-2 text-sm text-muted">{{ i18n.t('settings.body') }}</p>
      <div class="mt-8"><jk-user-settings /></div>
    </div>
  `,
})
export class SettingsPage {
  protected readonly i18n = inject(I18n);
}
