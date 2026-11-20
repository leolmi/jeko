import { httpResource } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { WorkflowRecord } from '@jeko/shared';
import { I18n } from '../core/i18n';
import { Projects } from '../core/projects';
import { Icon } from '../ui/icon';
import { Status } from '../ui/status';

/** Task del progetto attivo: prima quelli aperti, a richiesta anche quelli chiusi. */
@Component({
  selector: 'jk-tasks',
  imports: [RouterLink, Icon, Status],
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
            <li>
              <a
                class="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-subtle"
                [routerLink]="['/runs', t.id]"
              >
                <jk-status class="w-24" [status]="t.status" />
                <span class="flex-1 truncate text-sm">{{ t.request }}</span>
                <span class="shrink-0 text-xs text-faint">{{ i18n.ago(t.createdAt) }}</span>
              </a>
            </li>
          } @empty {
            <li class="px-4 py-6 text-center text-sm text-faint">{{ i18n.t('tasks.empty') }}</li>
          }
        </ul>
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
  protected remove(id: string, name: string): void {
    if (!globalThis.confirm(this.i18n.t('tasks.remove.confirm', { name }))) return;
    void this.projects.remove(id).catch(() => undefined);
  }
}
