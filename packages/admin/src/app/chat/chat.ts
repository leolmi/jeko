import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { I18n } from '../core/i18n';
import { Runs } from '../core/runs';
import { Icon } from '../ui/icon';
import { Status } from '../ui/status';

/** Chat: cronologia delle richieste a sinistra, composer o filo a destra. */
@Component({
  selector: 'jk-chat',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon, Status],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex h-full' },
  template: `
    <aside class="hidden w-72 shrink-0 flex-col border-r border-line md:flex">
      <div class="p-3">
        <a
          routerLink="/"
          class="jk-btn-outline w-full justify-start"
          routerLinkActive="bg-subtle"
          [routerLinkActiveOptions]="{ exact: true }"
        >
          <jk-icon name="add" [size]="18" />
          {{ i18n.t('runs.new') }}
        </a>
      </div>
      <p class="jk-label flex items-center gap-1.5 px-5 pt-2 pb-1">
        <jk-icon name="history" [size]="14" />
        {{ i18n.t('runs.history') }}
      </p>
      <nav class="flex-1 overflow-y-auto px-2 pb-3">
        @for (r of runs.list(); track r.id) {
          <a
            class="block rounded-lg px-3 py-2 transition-colors hover:bg-subtle"
            routerLinkActive="bg-subtle"
            [routerLink]="['/runs', r.id]"
          >
            <span class="block truncate text-sm">{{ r.request }}</span>
            <span class="mt-0.5 flex items-center gap-2">
              <jk-status [status]="r.status" />
              <span class="ml-auto truncate text-xs text-faint">{{ i18n.ago(r.createdAt) }}</span>
            </span>
          </a>
        } @empty {
          @if (runs.loaded()) {
            <p class="px-3 py-2 text-sm text-faint">{{ i18n.t('runs.empty') }}</p>
          }
        }
      </nav>
    </aside>
    <section class="min-w-0 flex-1">
      <router-outlet />
    </section>
  `,
})
export class Chat {
  protected readonly i18n = inject(I18n);
  protected readonly runs = inject(Runs);
}
