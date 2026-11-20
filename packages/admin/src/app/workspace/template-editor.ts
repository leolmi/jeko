import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  linkedSignal,
  model,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { Issue } from '@jeko/shared';
import { I18n } from '../core/i18n';
import { Templates } from '../core/templates';
import { Icon } from '../ui/icon';

/**
 * Template dei progetti: si sceglie quello da modificare (o uno nuovo), si scrive il prompt
 * e si salva col suo nome. Salvare con un nome diverso crea un template nuovo.
 */
@Component({
  selector: 'jk-template-editor',
  imports: [FormsModule, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="grid gap-3 sm:grid-cols-[1fr_1fr]">
      <label class="block">
        <span class="jk-label">{{ i18n.t('tpl.edit') }}</span>
        <select class="jk-input mt-1 text-sm" name="tpl-edit" [(ngModel)]="selected">
          <option value="">{{ i18n.t('tpl.new') }}</option>
          @for (t of templates.list(); track t.name) {
            <option [value]="t.name">{{ t.name }}</option>
          }
        </select>
      </label>
      <label class="block">
        <span class="jk-label">{{ i18n.t('tpl.name') }}</span>
        <input class="jk-input mt-1" name="tpl-name" autocomplete="off" [(ngModel)]="name" />
      </label>
    </div>
    <label class="mt-3 block">
      <span class="jk-label">{{ i18n.t('tpl.prompt') }}</span>
      <textarea
        class="jk-input mt-1 resize-y font-mono text-xs leading-relaxed"
        rows="6"
        name="tpl-prompt"
        spellcheck="false"
        [placeholder]="i18n.t('tpl.prompt.placeholder')"
        [(ngModel)]="prompt"
      ></textarea>
    </label>
    <p class="mt-1 text-xs text-faint">{{ i18n.t('tpl.prompt.hint') }}</p>
    <div class="mt-3 flex flex-wrap items-center gap-3">
      @for (i of issues(); track $index) {
        <p class="text-sm text-red-600 dark:text-red-400">{{ i.message }}</p>
      }
      @if (error()) {
        <p class="text-sm text-red-600 dark:text-red-400">{{ i18n.t('tpl.error') }}</p>
      } @else if (saved()) {
        <p class="text-sm text-faint">{{ i18n.t('project.saved') }}</p>
      }
      <span class="ml-auto flex gap-2">
        @if (selected()) {
          <button
            type="button"
            class="jk-btn-danger"
            [disabled]="busy()"
            [title]="i18n.t('tpl.delete')"
            [attr.aria-label]="i18n.t('tpl.delete')"
            (click)="remove()"
          >
            <jk-icon name="delete" [size]="18" />
          </button>
        }
        <button
          type="button"
          class="jk-btn-primary"
          [disabled]="!canSave() || busy()"
          (click)="save()"
        >
          <jk-icon name="save" [size]="16" />
          {{ i18n.t(isNew() ? 'tpl.saveNew' : 'project.save') }}
        </button>
      </span>
    </div>
  `,
})
export class TemplateEditor {
  protected readonly i18n = inject(I18n);
  protected readonly templates = inject(Templates);

  /** Template in modifica; '' = uno nuovo. */
  readonly selected = model('');
  private readonly current = computed(() =>
    this.templates.list().find((t) => t.name === this.selected()),
  );
  protected readonly name = linkedSignal(() => this.current()?.name ?? '');
  protected readonly prompt = linkedSignal(() => this.current()?.prompt ?? '');
  /** Il nome scritto non è quello del template scelto: si salva come nuovo. */
  protected readonly isNew = computed(() => this.name().trim() !== (this.current()?.name ?? ''));
  protected readonly canSave = computed(
    () =>
      !!this.name().trim() &&
      !!this.prompt().trim() &&
      (this.isNew() || this.prompt() !== this.current()?.prompt),
  );
  protected readonly busy = signal(false);
  protected readonly saved = signal(false);
  protected readonly error = signal(false);
  protected readonly issues = signal<Issue[]>([]);

  protected async save(): Promise<void> {
    if (!this.canSave() || this.busy()) return;
    this.start();
    try {
      const t = await this.templates.save(this.name().trim(), this.prompt());
      this.selected.set(t.name);
      this.saved.set(true);
    } catch (e) {
      const issues = e instanceof HttpErrorResponse && (e.error as { issues?: Issue[] })?.issues;
      if (issues) this.issues.set(issues);
      else this.error.set(true);
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const name = this.selected();
    if (!name || !globalThis.confirm(this.i18n.t('tpl.delete.confirm', { name }))) return;
    this.start();
    try {
      await this.templates.remove(name);
      this.selected.set('');
    } catch {
      this.error.set(true);
    } finally {
      this.busy.set(false);
    }
  }

  private start(): void {
    this.busy.set(true);
    this.saved.set(false);
    this.error.set(false);
    this.issues.set([]);
  }
}
