import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { I18n } from '../core/i18n';
import { isWindows, Settings } from '../core/settings';
import { Icon } from './icon';

/** Form delle opzioni dell'utente: nel primo avvio e nella pagina Opzioni. */
@Component({
  selector: 'jk-user-settings',
  imports: [FormsModule, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <form class="flex flex-col gap-1.5" (ngSubmit)="save()">
      <label class="jk-label" for="projectsDir">{{ i18n.t('settings.projectsDir') }}</label>
      <div class="flex gap-2">
        <input
          id="projectsDir"
          class="jk-input font-mono"
          name="projectsDir"
          autocomplete="off"
          spellcheck="false"
          [placeholder]="i18n.t(placeholder)"
          [(ngModel)]="projectsDir"
        />
        <button class="jk-btn-primary shrink-0" type="submit" [disabled]="!dirty() || saving()">
          <jk-icon [name]="saved() ? 'check' : 'save'" [size]="16" />
          {{ i18n.t(saved() ? 'settings.saved' : 'settings.save') }}
        </button>
      </div>
      <p class="text-xs text-faint">{{ i18n.t('settings.projectsDir.hint') }}</p>
      @if (error()) {
        <p class="text-xs text-red-600 dark:text-red-400">{{ i18n.t('settings.error') }}</p>
      }
    </form>
  `,
})
export class UserSettings {
  protected readonly i18n = inject(I18n);
  private readonly settings = inject(Settings);

  protected readonly placeholder = isWindows()
    ? 'settings.projectsDir.placeholder'
    : 'settings.projectsDir.placeholder.posix';
  protected readonly projectsDir = signal('');
  protected readonly saving = signal(false);
  protected readonly saved = signal(false);
  protected readonly error = signal(false);
  protected readonly dirty = computed(() => {
    const dir = this.projectsDir().trim();
    return !!dir && dir !== (this.settings.value()?.projectsDir ?? '');
  });

  constructor() {
    void this.settings
      .load()
      .then((s) => this.projectsDir.set(s.projectsDir ?? ''))
      .catch(() => this.error.set(true));
  }

  protected async save(): Promise<void> {
    if (!this.dirty()) return;
    this.saving.set(true);
    this.error.set(false);
    try {
      await this.settings.save({
        ...this.settings.value(),
        projectsDir: this.projectsDir().trim(),
      });
      this.saved.set(true);
      setTimeout(() => this.saved.set(false), 1500);
    } catch {
      this.error.set(true);
    } finally {
      this.saving.set(false);
    }
  }
}
