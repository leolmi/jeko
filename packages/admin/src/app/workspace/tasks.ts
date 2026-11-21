import { HttpClient, httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { RunSummary, WorkflowRecord } from '@jeko/shared';
import { I18n } from '../core/i18n';
import { isOpen, Projects } from '../core/projects';
import { Runs } from '../core/runs';
import { Icon } from '../ui/icon';
import { runTone, TONES } from '../ui/mode-tone';
import { RunPath } from '../ui/run-path';
import { Status } from '../ui/status';

/** Task del progetto attivo: prima quelli aperti, a richiesta anche quelli chiusi. */
@Component({
  selector: 'jk-tasks',
  imports: [RouterLink, Icon, Status, RunPath],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full overflow-y-auto' },
  template: `
    @if (projects.active(); as p) {
      <div class="px-6 py-5">
        <div class="flex items-baseline gap-3">
          <h2 class="truncate text-xl font-semibold tracking-tight">{{ p.name }}</h2>
          <span class="truncate font-mono text-xs text-faint">{{ p.path }}</span>
          <span class="ml-auto flex shrink-0 items-center gap-3">
            <a
              class="flex items-center gap-1 text-xs text-faint hover:text-fg"
              [title]="i18n.t('tasks.workflow.hint')"
              [routerLink]="['/progetti', p.id]"
            >
              <jk-icon name="account_tree" [size]="14" />
              <span class="font-mono">{{ p.workflow ?? develop()[0]?.name ?? '—' }}</span>
            </a>
            @if (p.path) {
              <button
                type="button"
                class="jk-btn-ghost px-1.5 py-1"
                [class.text-red-600]="terminalError()"
                [title]="i18n.t(terminalError() ? 'tasks.terminal.error' : 'tasks.terminal')"
                [attr.aria-label]="i18n.t('tasks.terminal')"
                (click)="openTerminal(p.id)"
              >
                <jk-icon name="terminal" [size]="16" />
              </button>
            }
            <a
              class="jk-btn-ghost px-1.5 py-1"
              [title]="i18n.t('project.settings')"
              [attr.aria-label]="i18n.t('project.settings')"
              [routerLink]="['/progetti', p.id]"
            >
              <jk-icon name="settings" [size]="16" />
            </a>
            @if (p.closed.length) {
              <button
                type="button"
                class="text-xs text-faint hover:text-fg"
                (click)="showClosed.set(!showClosed())"
              >
                {{
                  showClosed()
                    ? i18n.t('tasks.hideClosed')
                    : i18n.t('tasks.showClosed', { n: p.closed.length })
                }}
              </button>
            }
            <button
              type="button"
              class="jk-btn-danger py-1"
              [title]="i18n.t('tasks.remove')"
              [attr.aria-label]="i18n.t('tasks.remove')"
              (click)="remove(p.id, p.name)"
            >
              <jk-icon name="delete" [size]="18" />
            </button>
          </span>
        </div>
        @if (!p.path) {
          <p class="mt-2 text-sm text-amber-700 dark:text-amber-400">
            {{ i18n.t('tasks.noPath') }}
          </p>
        }

        <ul
          class="mt-4 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface"
        >
          @for (t of tasks(); track t.id) {
            <li class="flex items-center transition-colors hover:bg-subtle">
              <a
                class="flex min-w-0 flex-1 items-center gap-3 px-4 py-3"
                [routerLink]="['/runs', t.id]"
              >
                <jk-status class="w-24" [status]="t.status" />
                @let tone = runTone(t);
                <span
                  class="size-2.5 shrink-0 rounded-full"
                  [class]="tone.dot"
                  [title]="i18n.t(tone.label)"
                  [attr.aria-label]="i18n.t(tone.label)"
                  role="img"
                ></span>
                <span class="flex min-w-0 flex-1 flex-col gap-1.5">
                  <span class="truncate text-sm">{{ t.request }}</span>
                  @if (t.path.length) {
                    <jk-run-path [path]="t.path" [tone]="tone" [direct]="tone === tones.direct" />
                  }
                </span>
                <span class="shrink-0 text-xs text-faint" [title]="i18n.dateTime(t.createdAt)">{{
                  i18n.ago(t.createdAt)
                }}</span>
              </a>
              @if (!isOpen(t)) {
                <button
                  type="button"
                  class="jk-btn-danger mr-2 py-1"
                  [title]="i18n.t('tasks.delete')"
                  [attr.aria-label]="i18n.t('tasks.delete')"
                  (click)="deleteTasks([t.id], t.request)"
                >
                  <jk-icon name="delete" [size]="16" />
                </button>
              }
            </li>
          } @empty {
            <li class="px-4 py-6 text-center text-sm text-faint">{{ i18n.t('tasks.empty') }}</li>
          }
        </ul>
        @if (showClosed() && p.closed.length > 1) {
          <div class="mt-2 flex justify-end">
            <button
              type="button"
              class="jk-btn-danger text-xs"
              (click)="deleteTasks(closedIds(p.closed), null)"
            >
              <jk-icon name="delete" [size]="16" />
              {{ i18n.t('tasks.deleteClosed', { n: p.closed.length }) }}
            </button>
          </div>
        }
        @if (deleteError()) {
          <p class="mt-2 text-right text-xs text-red-600 dark:text-red-400">
            {{ i18n.t('tasks.delete.error') }}
          </p>
        }
      </div>
    } @else if (projects.loaded()) {
      <p class="flex h-full items-center justify-center text-sm text-faint">
        {{ i18n.t('tasks.none') }}
      </p>
    }
  `,
})
export class Tasks {
  protected readonly i18n = inject(I18n);
  protected readonly projects = inject(Projects);
  protected readonly showClosed = signal(false);
  protected readonly tasks = computed(() => {
    const p = this.projects.active();
    if (!p) return [];
    return this.showClosed() ? [...p.open, ...p.closed] : p.open;
  });

  private readonly workflows = httpResource<WorkflowRecord[]>(() => '/api/workflows');
  protected readonly develop = computed(() =>
    (this.workflows.hasValue() ? this.workflows.value() : []).filter((w) => w.kind === 'develop'),
  );
  private readonly http = inject(HttpClient);
  protected readonly terminalError = signal(false);

  /** Terminale sul PC nella cartella del progetto: login, dati sensibili… */
  protected openTerminal(id: string): void {
    this.terminalError.set(false);
    this.http.post(`/api/projects/${id}/terminal`, null).subscribe({
      error: () => this.terminalError.set(true),
    });
  }

  private readonly runs = inject(Runs);
  protected readonly isOpen = isOpen;
  protected readonly runTone = runTone;
  protected readonly tones = TONES;
  protected readonly deleteError = signal(false);
  protected closedIds = (closed: RunSummary[]) => closed.map((r) => r.id);

  /** Elimina task conclusi, con i loro eventi: uno (con la sua richiesta) o tutti i chiusi. */
  protected deleteTasks(ids: string[], request: string | null): void {
    const ask =
      request === null
        ? this.i18n.t('tasks.deleteClosed.confirm', { n: ids.length })
        : this.i18n.t('tasks.delete.confirm', { request: request.slice(0, 80) });
    if (!globalThis.confirm(ask)) return;
    this.deleteError.set(false);
    this.runs.remove(ids).catch(() => this.deleteError.set(true));
  }

  protected remove(id: string, name: string): void {
    if (!globalThis.confirm(this.i18n.t('tasks.remove.confirm', { name }))) return;
    void this.projects.remove(id).catch(() => undefined);
  }
}
