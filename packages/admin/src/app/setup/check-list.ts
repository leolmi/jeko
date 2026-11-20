import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import type { Check } from '@jeko/shared';
import { I18n, type I18nKey } from '../core/i18n';
import { Icon } from '../ui/icon';

/** Elenco di verifiche: esito, dettaglio e, se fallita, come rimediare. */
@Component({
  selector: 'jk-check-list',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul class="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
      @for (c of checks(); track c.id) {
        <li class="flex gap-3 px-4 py-3">
          @if (c.ok) {
            <jk-icon name="check_circle" [size]="20" class="text-emerald-500" />
          } @else if (c.severity === 'warn') {
            <jk-icon name="warning" [size]="20" class="text-amber-500" />
          } @else {
            <jk-icon name="error" [size]="20" class="text-red-500" />
          }
          <div class="min-w-0 flex-1">
            <p class="text-sm font-medium">{{ i18n.t(key(c.id, 'title')) }}</p>
            @if (c.detail) {
              <p class="mt-0.5 truncate font-mono text-xs text-faint" [title]="c.detail">
                {{ c.detail }}
              </p>
            }
            @if (!c.ok) {
              <p
                class="mt-1 text-xs"
                [class]="
                  c.severity === 'warn'
                    ? 'text-amber-700 dark:text-amber-400'
                    : 'text-red-700 dark:text-red-400'
                "
              >
                {{ i18n.t(key(c.id, 'fix')) }}
              </p>
            }
          </div>
        </li>
      }
    </ul>
  `,
})
export class CheckList {
  protected readonly i18n = inject(I18n);
  readonly checks = input.required<readonly Check[]>();

  protected key(id: string, part: 'title' | 'fix'): I18nKey {
    return `check.${id}.${part}` as I18nKey;
  }
}
