import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { Note, NoteKind } from '@jeko/shared';
import { I18n } from '../core/i18n';
import { Notes } from '../core/notes';
import { Projects } from '../core/projects';
import { Icon } from '../ui/icon';
import { Segmented, type SegmentOption } from '../ui/segmented';

interface Group {
  /** Id del progetto; '' = senza progetto. */
  id: string;
  name: string;
  notes: Note[];
}

/**
 * Note ancora da lavorare, raggruppate per progetto: idee e problemi visti, in pratica dei
 * prompt. Senza progetto possono diventare un progetto nuovo.
 */
@Component({
  selector: 'jk-notes-page',
  imports: [Icon, Segmented],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full overflow-y-auto' },
  template: `
    <div class="mx-auto max-w-3xl px-6 py-6">
      <h2 class="text-xl font-semibold tracking-tight">{{ i18n.t('notes.title') }}</h2>

      <!-- Nuova nota: si scrive al volo, Ctrl+Invio per aggiungerla. -->
      <div class="mt-4 rounded-xl border border-line bg-surface p-3">
        <textarea
          class="block w-full resize-y bg-transparent text-sm leading-relaxed outline-none"
          rows="3"
          [attr.aria-label]="i18n.t('notes.new')"
          [placeholder]="i18n.t('notes.placeholder')"
          [value]="body()"
          (input)="body.set($any($event.target).value)"
          (keydown.control.enter)="add()"
        ></textarea>
        <div class="mt-2 flex flex-wrap items-center gap-3">
          <jk-segmented [label]="i18n.t('notes.kind')" [options]="kinds()" [(value)]="kind" />
          <select
            class="jk-input w-auto max-w-56 py-1.5"
            [attr.aria-label]="i18n.t('notes.project')"
            [value]="projectId()"
            (change)="projectId.set($any($event.target).value)"
          >
            <option value="">{{ i18n.t('notes.noProject') }}</option>
            @for (p of projectOptions(); track p.id) {
              <option [value]="p.id">{{ p.name }}</option>
            }
          </select>
          @if (error()) {
            <span class="text-xs text-red-600 dark:text-red-400">{{ i18n.t('notes.error') }}</span>
          }
          <button
            type="button"
            class="jk-btn-primary ml-auto"
            [disabled]="!body().trim() || saving()"
            (click)="add()"
          >
            <jk-icon name="add" [size]="16" />
            {{ i18n.t('notes.add') }}
          </button>
        </div>
      </div>

      @for (g of groups(); track g.id) {
        <section class="mt-7">
          <h3 class="mb-2 px-1 text-xs font-medium tracking-wide text-faint uppercase">
            {{ g.name }}
          </h3>
          <ul class="flex flex-col gap-2">
            @for (n of g.notes; track n.id) {
              <li
                class="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-xl border border-line bg-surface px-4 py-3"
              >
                <span
                  class="mt-0.5 shrink-0"
                  [class]="n.kind === 'idea' ? 'text-amber-500' : 'text-red-500'"
                  [title]="i18n.t(n.kind === 'idea' ? 'notes.idea' : 'notes.issue')"
                  role="img"
                  [attr.aria-label]="i18n.t(n.kind === 'idea' ? 'notes.idea' : 'notes.issue')"
                >
                  <jk-icon [name]="n.kind === 'idea' ? 'lightbulb' : 'bug_report'" [size]="18" />
                </span>
                @if (editing() === n.id) {
                  <div class="flex min-w-48 flex-1 flex-col gap-2">
                    <textarea
                      class="jk-input min-h-24 w-full text-sm"
                      [attr.aria-label]="i18n.t('notes.edit')"
                      [value]="editBody()"
                      (input)="editBody.set($any($event.target).value)"
                      (keydown.control.enter)="save(n)"
                      (keydown.escape)="editing.set(null)"
                    ></textarea>
                    <div class="flex flex-wrap items-center gap-2">
                      <jk-segmented
                        [label]="i18n.t('notes.kind')"
                        [options]="kinds()"
                        [(value)]="editKind"
                      />
                      <select
                        class="jk-input w-auto max-w-56 py-1.5"
                        [attr.aria-label]="i18n.t('notes.project')"
                        [value]="editProject()"
                        (change)="editProject.set($any($event.target).value)"
                      >
                        <option value="">{{ i18n.t('notes.noProject') }}</option>
                        @for (p of projectOptions(); track p.id) {
                          <option [value]="p.id">{{ p.name }}</option>
                        }
                      </select>
                      <button
                        type="button"
                        class="jk-btn-ghost ml-auto"
                        (click)="editing.set(null)"
                      >
                        {{ i18n.t('notes.cancel') }}
                      </button>
                      <button
                        type="button"
                        class="jk-btn-primary"
                        [disabled]="!editBody().trim()"
                        (click)="save(n)"
                      >
                        {{ i18n.t('notes.save') }}
                      </button>
                    </div>
                  </div>
                } @else {
                  <div class="min-w-48 flex-1">
                    <p
                      class="text-sm leading-relaxed break-words whitespace-pre-wrap"
                      [textContent]="n.body"
                    ></p>
                    <p class="mt-1 flex items-center gap-2 text-xs text-faint">
                      <span [title]="i18n.dateTime(n.createdAt)">{{ i18n.ago(n.createdAt) }}</span>
                      @if (notes.isPending(n)) {
                        <span class="text-amber-700 dark:text-amber-400">{{
                          i18n.t(n.projectId ? 'notes.pending' : 'notes.pending.new')
                        }}</span>
                      }
                    </p>
                  </div>
                  <span class="ml-auto flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      class="jk-btn-outline py-1 text-xs"
                      [title]="i18n.t(n.projectId ? 'notes.toTask.hint' : 'notes.toProject.hint')"
                      (click)="toTask(n)"
                    >
                      <jk-icon name="arrow_forward" [size]="14" />
                      {{ i18n.t(n.projectId ? 'notes.toTask' : 'notes.toProject') }}
                    </button>
                    <button
                      type="button"
                      class="jk-btn-ghost px-1.5 py-1"
                      [title]="i18n.t('notes.edit')"
                      [attr.aria-label]="i18n.t('notes.edit')"
                      (click)="edit(n)"
                    >
                      <jk-icon name="edit" [size]="16" />
                    </button>
                    <button
                      type="button"
                      class="jk-btn-danger py-1"
                      [title]="i18n.t('notes.delete')"
                      [attr.aria-label]="i18n.t('notes.delete')"
                      (click)="remove(n)"
                    >
                      <jk-icon name="delete" [size]="16" />
                    </button>
                  </span>
                }
              </li>
            }
          </ul>
        </section>
      } @empty {
        @if (notes.loaded()) {
          <p class="mt-10 text-center text-sm text-faint">{{ i18n.t('notes.empty') }}</p>
        }
      }
    </div>
  `,
})
export class NotesPage {
  protected readonly i18n = inject(I18n);
  protected readonly notes = inject(Notes);
  private readonly projects = inject(Projects);
  private readonly router = inject(Router);

  protected readonly body = signal('');
  protected readonly kind = signal<NoteKind>('idea');
  /** Progetto della nuova nota: parte da quello attivo; '' = nessuno. */
  protected readonly projectId = signal(this.projects.activeId() ?? '');
  protected readonly saving = signal(false);
  protected readonly error = signal(false);
  protected readonly editing = signal<string | null>(null);
  protected readonly editBody = signal('');
  protected readonly editKind = signal<NoteKind>('idea');
  protected readonly editProject = signal('');

  protected readonly kinds = computed((): SegmentOption<NoteKind>[] => [
    { value: 'idea', label: this.i18n.t('notes.idea'), icon: 'lightbulb' },
    { value: 'issue', label: this.i18n.t('notes.issue'), icon: 'bug_report' },
  ]);
  protected readonly projectOptions = computed(() =>
    [...this.projects.list()].sort((a, b) => a.name.localeCompare(b.name)),
  );

  /** Note da fare per progetto, in ordine di nome; quelle senza progetto in fondo. */
  protected readonly groups = computed((): Group[] => {
    const todo = this.notes.todo();
    const groups: Group[] = this.projectOptions()
      .map((p) => ({ id: p.id, name: p.name, notes: todo.filter((n) => n.projectId === p.id) }))
      .filter((g) => g.notes.length);
    const loose = todo.filter((n) => !n.projectId);
    if (loose.length) groups.push({ id: '', name: this.i18n.t('notes.noProject'), notes: loose });
    return groups;
  });

  constructor() {
    this.notes.load();
  }

  protected add(): void {
    const body = this.body().trim();
    if (!body || this.saving()) return;
    this.saving.set(true);
    this.error.set(false);
    this.notes
      .add({ body, kind: this.kind(), projectId: this.projectId() || null })
      .then(() => this.body.set(''))
      .catch(() => this.error.set(true))
      .finally(() => this.saving.set(false));
  }

  protected edit(n: Note): void {
    this.editBody.set(n.body);
    this.editKind.set(n.kind);
    this.editProject.set(n.projectId ?? '');
    this.editing.set(n.id);
  }

  protected save(n: Note): void {
    const body = this.editBody().trim();
    if (!body) return;
    this.notes
      .update(n, { body, kind: this.editKind(), projectId: this.editProject() || null })
      .then(() => this.editing.set(null))
      .catch(() => this.error.set(true));
  }

  /** Con un progetto: la sua chat, col testo pronto. Senza: un progetto nuovo. */
  protected toTask(n: Note): void {
    this.notes.toTask(n);
    void this.router.navigate([n.projectId ? '/' : '/nuovo']);
  }

  protected remove(n: Note): void {
    if (!globalThis.confirm(this.i18n.t('notes.delete.confirm', { text: n.body.slice(0, 80) })))
      return;
    this.notes.remove(n).catch(() => this.error.set(true));
  }
}
