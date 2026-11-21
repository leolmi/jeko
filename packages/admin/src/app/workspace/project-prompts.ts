import { HttpClient, HttpErrorResponse, httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { Issue, ProjectPrompt } from '@jeko/shared';
import { firstValueFrom, type Observable } from 'rxjs';
import { I18n } from '../core/i18n';
import { Icon } from '../ui/icon';

const NAME = /^[a-z][a-z0-9-]*$/;

/**
 * Prompt del progetto (`.jeko/prompts/<nome>.md`): i passi `prompt: <nome>` dei workflow
 * li eseguono, e chi non ne ha uno salta il passo. Li legge e scrive il runner.
 */
@Component({
  selector: 'jk-project-prompts',
  imports: [FormsModule, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex items-center gap-3">
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium">{{ i18n.t('prompts.title') }}</p>
        <p class="mt-0.5 text-xs text-faint">{{ i18n.t('prompts.hint') }}</p>
      </div>
      @if (!editing()) {
        <button type="button" class="jk-btn-outline" (click)="edit('', '')">
          <jk-icon name="add" [size]="16" /> {{ i18n.t('prompts.add') }}
        </button>
      }
    </div>

    @if (list.error()) {
      <p class="mt-3 text-sm text-amber-700 dark:text-amber-400">
        {{ i18n.t('prompts.offline') }}
      </p>
    } @else {
      <ul class="mt-3 divide-y divide-line overflow-hidden rounded-lg border border-line">
        @for (row of rows(); track row.name) {
          <li class="flex items-center gap-3 px-3 py-2">
            <span class="font-mono text-sm">{{ row.name }}</span>
            @if (row.text === null) {
              <span class="text-xs text-faint">{{ i18n.t('prompts.missing') }}</span>
            } @else {
              <span class="min-w-0 flex-1 truncate text-xs text-muted">{{ row.text }}</span>
            }
            <span class="ml-auto flex shrink-0 items-center gap-1">
              @if (row.used) {
                <span class="text-xs text-faint" [title]="i18n.t('prompts.used.hint')">{{
                  i18n.t('prompts.used')
                }}</span>
              }
              <button
                type="button"
                class="jk-btn-ghost px-2 py-1 text-xs"
                (click)="edit(row.name, row.text ?? '')"
              >
                {{ i18n.t(row.text === null ? 'prompts.create' : 'prompts.edit') }}
              </button>
              @if (row.text !== null) {
                <button
                  type="button"
                  class="jk-btn-danger py-1"
                  [title]="i18n.t('prompts.delete')"
                  [attr.aria-label]="i18n.t('prompts.delete')"
                  (click)="remove(row.name)"
                >
                  <jk-icon name="delete" [size]="16" />
                </button>
              }
            </span>
          </li>
        } @empty {
          <li class="px-3 py-4 text-center text-sm text-faint">{{ i18n.t('prompts.empty') }}</li>
        }
      </ul>
    }

    @if (editing(); as e) {
      <form class="mt-3 flex flex-col gap-2" (ngSubmit)="save()">
        <label class="text-xs text-muted">
          {{ i18n.t('prompts.name') }}
          <input
            class="jk-input mt-1 font-mono"
            name="prompt-name"
            autocomplete="off"
            placeholder="end-develop"
            [readonly]="e.existing"
            [ngModel]="e.name"
            (ngModelChange)="patch({ name: $event })"
          />
        </label>
        <label class="text-xs text-muted">
          {{ i18n.t('prompts.text') }}
          <textarea
            class="jk-input mt-1 resize-y text-sm leading-relaxed"
            rows="8"
            name="prompt-text"
            [placeholder]="i18n.t('prompts.text.placeholder')"
            [ngModel]="e.text"
            (ngModelChange)="patch({ text: $event })"
          ></textarea>
        </label>
        @for (issue of issues(); track $index) {
          <p class="text-xs text-red-600 dark:text-red-400">{{ issue.message }}</p>
        }
        @if (error()) {
          <p class="text-xs text-red-600 dark:text-red-400">{{ error() }}</p>
        }
        <div class="flex gap-2">
          <button type="submit" class="jk-btn-primary" [disabled]="!valid() || busy()">
            <jk-icon name="save" [size]="16" /> {{ i18n.t('project.save') }}
          </button>
          <button type="button" class="jk-btn-outline" (click)="editing.set(null)">
            {{ i18n.t('prompts.cancel') }}
          </button>
        </div>
      </form>
    }
  `,
})
export class ProjectPrompts {
  protected readonly i18n = inject(I18n);
  private readonly http = inject(HttpClient);
  readonly projectId = input.required<string>();
  /** Prompt chiamati dal workflow del progetto: si mostrano anche se mancano. */
  readonly used = input<string[]>([]);

  protected readonly list = httpResource<ProjectPrompt[]>(
    () => `/api/projects/${this.projectId()}/prompts`,
  );
  protected readonly rows = computed(() => {
    const have = this.list.hasValue() ? this.list.value() : [];
    const used = new Set(this.used());
    const missing = [...used]
      .filter((n) => !have.some((p) => p.name === n))
      .map((name) => ({ name, text: null, used: true }));
    return [
      ...missing,
      ...have.map((p) => ({ name: p.name, text: p.text.trim(), used: used.has(p.name) })),
    ];
  });

  protected readonly editing = signal<{ name: string; text: string; existing: boolean } | null>(
    null,
  );
  protected readonly busy = signal(false);
  protected readonly issues = signal<Issue[]>([]);
  protected readonly error = signal('');
  protected readonly valid = computed(() => {
    const e = this.editing();
    return !!e && NAME.test(e.name) && e.text.trim().length > 0;
  });

  protected edit(name: string, text: string): void {
    const have = this.list.hasValue() ? this.list.value() : [];
    const existing = have.find((p) => p.name === name);
    this.issues.set([]);
    this.error.set('');
    this.editing.set({ name, text: existing?.text ?? text, existing: !!existing });
  }

  protected patch(p: Partial<{ name: string; text: string }>): void {
    this.editing.update((e) => (e ? { ...e, ...p } : e));
  }

  protected async save(): Promise<void> {
    const e = this.editing();
    if (!e || !this.valid() || this.busy()) return;
    await this.call(() => this.http.put<ProjectPrompt[]>(this.url(e.name), { text: e.text })).then(
      (ok) => ok && this.editing.set(null),
    );
  }

  protected async remove(name: string): Promise<void> {
    if (!globalThis.confirm(this.i18n.t('prompts.delete.confirm', { name }))) return;
    await this.call(() => this.http.delete<ProjectPrompt[]>(this.url(name)));
  }

  private url(name: string): string {
    return `/api/projects/${this.projectId()}/prompts/${encodeURIComponent(name)}`;
  }

  /** Salva o elimina; la risposta è l'elenco aggiornato. */
  private async call(req: () => Observable<ProjectPrompt[]>): Promise<boolean> {
    this.busy.set(true);
    this.issues.set([]);
    this.error.set('');
    try {
      this.list.set(await firstValueFrom(req()));
      return true;
    } catch (e) {
      const body =
        e instanceof HttpErrorResponse ? (e.error as { message?: string; issues?: Issue[] }) : null;
      if (body?.issues?.length) this.issues.set(body.issues);
      else this.error.set(body?.message ?? this.i18n.t('project.save.error'));
      return false;
    } finally {
      this.busy.set(false);
    }
  }
}
