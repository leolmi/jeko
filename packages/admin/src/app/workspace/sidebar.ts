import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { I18n, type I18nKey } from '../core/i18n';
import { Projects } from '../core/projects';
import { storage } from '../core/storage';
import type { RunSummary } from '@jeko/shared';
import { Icon } from '../ui/icon';
import { runTone } from '../ui/mode-tone';
import { Status } from '../ui/status';
import { favoritesOf, moveId, othersOf, SORTS, type Sort } from './project-list';

/** Dove cade il preferito trascinato: prima o dopo un altro. */
interface DropAt {
  id: string;
  after: boolean;
}

/**
 * Elenco dei progetti: in alto i preferiti, nel loro ordine (si riordinano trascinandoli);
 * sotto gli altri, con ricerca, ordinamento e contatori dei task aperti.
 */
@Component({
  selector: 'jk-sidebar',
  imports: [NgTemplateOutlet, RouterLink, RouterLinkActive, Icon, Status],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col' },
  template: `
    <ng-template #row let-p>
      <div class="group relative mb-0.5">
        <button
          type="button"
          class="block w-full rounded-lg py-2 pr-8 pl-3 text-left transition-colors hover:bg-subtle"
          [class.bg-subtle]="p.id === projects.active()?.id"
          [attr.aria-current]="p.id === projects.active()?.id || null"
          (click)="open(p.id)"
        >
          <span class="flex items-center gap-1.5">
            <span class="flex-1 truncate text-sm" [class.font-medium]="p.open.length">{{
              p.name
            }}</span>
            @if (projects.drafts()[p.id]) {
              <span class="text-xs text-faint" [title]="i18n.t('ws.draft')">✎</span>
            }
            <!--
              Un pallino per task aperto, del colore della sua modalità: pulsa se lavora,
              ha un cerchio attorno (fermo) se aspetta l'utente, è sbiadito se in coda.
            -->
            @for (r of p.open.slice(0, 4); track r.id) {
              <span
                class="flex size-3.5 items-center justify-center rounded-full"
                [class]="r.status === 'waiting' ? 'border-[1.5px] ' + tone(r).ringBorder : ''"
                [title]="i18n.t(tone(r).label) + ' · ' + i18n.t(statusLabel(r))"
              >
                <span
                  class="size-2 rounded-full"
                  [class]="tone(r).dot"
                  [class.animate-pulse]="r.status === 'running'"
                  [class.opacity-40]="r.status === 'queued'"
                ></span>
              </span>
            }
          </span>
          <span class="mt-0.5 flex items-center gap-2 text-xs text-faint">
            <span class="truncate font-mono">{{ p.path }}</span>
            <span class="ml-auto shrink-0" [title]="i18n.dateTime(p.last)">{{
              i18n.ago(p.last)
            }}</span>
          </span>
        </button>
        <button
          type="button"
          class="absolute top-1.5 right-1.5 rounded p-0.5 transition-opacity hover:text-fg focus-visible:opacity-100"
          [class]="
            p.favorite !== undefined
              ? 'text-accent'
              : 'text-faint opacity-0 group-hover:opacity-100'
          "
          [title]="i18n.t(p.favorite !== undefined ? 'ws.favorite.remove' : 'ws.favorite.add')"
          [attr.aria-label]="
            i18n.t(p.favorite !== undefined ? 'ws.favorite.remove' : 'ws.favorite.add')
          "
          [attr.aria-pressed]="p.favorite !== undefined"
          (click)="toggleFavorite(p.id)"
        >
          <jk-icon [name]="p.favorite !== undefined ? 'star' : 'star_border'" [size]="16" />
        </button>
      </div>
    </ng-template>

    <div class="space-y-2 p-3 pb-2">
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
    </div>

    <nav class="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      @if (favorites().length) {
        <p class="jk-label px-3 pt-1 pb-1">{{ i18n.t('ws.favorites') }}</p>
        <ul [attr.aria-label]="i18n.t('ws.favorites')">
          @for (p of favorites(); track p.id) {
            <li
              draggable="true"
              class="relative cursor-grab"
              [class.opacity-50]="dragging() === p.id"
              [title]="i18n.t('ws.favorite.drag')"
              (dragstart)="dragStart($event, p.id)"
              (dragover)="dragOver($event, p.id)"
              (drop)="drop($event)"
              (dragend)="dragEnd()"
            >
              @if (dropAt()?.id === p.id) {
                <span
                  class="pointer-events-none absolute inset-x-2 h-0.5 rounded bg-accent"
                  [class]="dropAt()?.after ? '-bottom-px' : '-top-px'"
                ></span>
              }
              <ng-container *ngTemplateOutlet="row; context: { $implicit: p }" />
            </li>
          }
        </ul>
        <div class="mx-3 my-2 h-px bg-line"></div>
      }

      <div class="space-y-2 px-1 pb-2">
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
        <ng-container *ngTemplateOutlet="row; context: { $implicit: p }" />
      } @empty {
        @if (projects.loaded() && !(favorites().length && !query().trim())) {
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

  protected readonly favorites = computed(() => favoritesOf(this.projects.views()));
  protected readonly shown = computed(() =>
    othersOf(this.projects.views(), this.query(), this.sort()),
  );

  /** Preferito che si sta trascinando, e dove cadrebbe. */
  protected readonly dragging = signal<string | null>(null);
  protected readonly dropAt = signal<DropAt | null>(null);

  constructor() {
    effect(() => storage.set('sort', this.sort()));
  }

  protected sortLabel(s: Sort): I18nKey {
    return `ws.sort.${s}`;
  }

  protected readonly tone = runTone;

  protected statusLabel(r: RunSummary): I18nKey {
    return `status.${r.status}` as I18nKey;
  }

  protected open(id: string): void {
    this.projects.activeId.set(id);
    void this.router.navigate(['/']);
  }

  protected toggleFavorite(id: string): void {
    void this.projects.toggleFavorite(id).catch(() => undefined);
  }

  protected dragStart(e: DragEvent, id: string): void {
    this.dragging.set(id);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
    }
  }

  protected dragOver(e: DragEvent, id: string): void {
    const from = this.dragging();
    if (!from) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const after = e.clientY > box.top + box.height / 2;
    const at = this.dropAt();
    if (id === from) this.dropAt.set(null);
    else if (at?.id !== id || at.after !== after) this.dropAt.set({ id, after });
  }

  protected drop(e: DragEvent): void {
    e.preventDefault();
    const from = this.dragging();
    const at = this.dropAt();
    this.dragEnd();
    if (!from || !at) return;
    const ids = this.favorites().map((p) => p.id);
    const next = moveId(ids, from, at.id, at.after);
    if (next.join() !== ids.join()) void this.projects.setFavorites(next).catch(() => undefined);
  }

  protected dragEnd(): void {
    this.dragging.set(null);
    this.dropAt.set(null);
  }
}
