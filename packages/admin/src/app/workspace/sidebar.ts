import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { I18n, type I18nKey } from '../core/i18n';
import { Projects } from '../core/projects';
import { storage } from '../core/storage';
import { Icon } from '../ui/icon';
import { Status } from '../ui/status';

type Sort = 'activity' | 'waiting' | 'name';
const SORTS: Sort[] = ['activity', 'waiting', 'name'];

/** Elenco dei progetti: ricerca, ordinamento, contatori dei task aperti. */
@Component({
  selector: 'jk-sidebar',
  imports: [RouterLink, RouterLinkActive, Icon, Status],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col' },
  template: `
    <div class="space-y-2 p-3">
      <div class="flex items-center gap-2">
        <h1 class="text-sm font-semibold">{{ i18n.t('nav.projects') }}</h1>
        <span class="text-xs text-faint">{{ projects.list().length }}</span>
        <a
          routerLink="/nuovo"
          class="jk-btn-ghost -mr-1 ml-auto px-1.5 py-1"
          routerLinkActive="bg-subtle !text-fg"
          [title]="i18n.t('ws.add')"
          [attr.aria-label]="i18n.t('ws.add')"
        >
          <jk-icon name="create_new_folder" [size]="18" />
        </a>
      </div>
      <input
        class="jk-input py-1.5 text-sm"
        type="search"
        [placeholder]="i18n.t('ws.search')"
        [attr.aria-label]="i18n.t('ws.search')"
        [value]="query()"
        (input)="query.set($any($event.target).value)"
      />
      <div class="flex gap-1 text-xs" role="radiogroup" [attr.aria-label]="i18n.t('ws.sort')">
        @for (s of sorts; track s) {
          <button
            type="button"
            role="radio"
            class="rounded-md px-2 py-0.5 transition-colors"
            [class]="sort() === s ? 'bg-subtle text-fg' : 'text-muted hover:text-fg'"
            [attr.aria-checked]="sort() === s"
            (click)="sort.set(s)"
          >
            {{ i18n.t(sortLabel(s)) }}
          </button>
        }
      </div>
    </div>

    <nav class="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      @if (projects.creating().length) {
        <p class="jk-label px-3 pt-1 pb-1">{{ i18n.t('ws.creating') }}</p>
        @for (r of projects.creating(); track r.id) {
          <a
            class="mb-0.5 block rounded-lg px-3 py-2 transition-colors hover:bg-subtle"
            routerLinkActive="bg-subtle"
            [routerLink]="['/runs', r.id]"
          >
            <span class="block truncate text-sm">{{ r.request }}</span>
            <jk-status class="mt-0.5" [status]="r.status" />
          </a>
        }
        <div class="mx-3 my-2 h-px bg-line"></div>
      }
      @for (p of shown(); track p.id) {
        <button
          type="button"
          class="mb-0.5 block w-full rounded-lg px-3 py-2 text-left transition-colors hover:bg-subtle"
          [class.bg-subtle]="p.id === projects.active()?.id"
          [attr.aria-current]="p.id === projects.active()?.id || null"
          (click)="open(p.id)"
        >
          <span class="flex items-center gap-2">
            <span class="flex-1 truncate text-sm" [class.font-medium]="p.open.length">{{
              p.name
            }}</span>
            @if (projects.drafts()[p.id]) {
              <span class="text-xs text-faint" [title]="i18n.t('ws.draft')">✎</span>
            }
            @if (p.waiting) {
              <span
                class="rounded-full bg-amber-500/15 px-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400"
                [title]="i18n.t('ws.waiting')"
                >{{ p.waiting }}</span
              >
            }
            @if (p.open.length - p.waiting) {
              <span
                class="rounded-full bg-subtle px-1.5 text-xs text-muted"
                [title]="i18n.t('ws.inProgress')"
                >{{ p.open.length - p.waiting }}</span
              >
            }
          </span>
          <span class="mt-0.5 flex items-center gap-2 text-xs text-faint">
            <span class="truncate font-mono">{{ p.path }}</span>
            <span class="ml-auto shrink-0" [title]="i18n.dateTime(p.last)">{{
              i18n.ago(p.last)
            }}</span>
          </span>
        </button>
      } @empty {
        @if (projects.loaded()) {
          <p class="px-3 py-2 text-sm text-faint">
            {{ i18n.t(projects.list().length ? 'ws.noMatch' : 'ws.empty') }}
          </p>
        }
      }
    </nav>
  `,
})
export class Sidebar {
  protected readonly i18n = inject(I18n);
  protected readonly projects = inject(Projects);
  private readonly router = inject(Router);
  protected readonly sorts = SORTS;
  protected readonly query = signal('');
  protected readonly sort = signal<Sort>(
    SORTS.find((s) => s === storage.get('sort')) ?? 'activity',
  );

  protected readonly shown = computed(() => {
    const q = this.query().trim().toLowerCase();
    const by = this.sort();
    return this.projects
      .views()
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q))
      .sort((a, b) =>
        by === 'name'
          ? a.name.localeCompare(b.name)
          : by === 'waiting'
            ? b.waiting - a.waiting || b.open.length - a.open.length || b.last.localeCompare(a.last)
            : b.last.localeCompare(a.last),
      );
  });

  constructor() {
    effect(() => storage.set('sort', this.sort()));
  }

  protected sortLabel(s: Sort): I18nKey {
    return `ws.sort.${s}`;
  }

  protected open(id: string): void {
    this.projects.activeId.set(id);
    void this.router.navigate(['/']);
  }
}
