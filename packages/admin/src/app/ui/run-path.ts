import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { StepMark } from '@jeko/shared';
import { I18n } from '../core/i18n';
import type { Tone } from './mode-tone';

/** Oltre questi pallini si mostrano i primi e gli ultimi, con "…" in mezzo. */
const MAX = 12;
const EDGE = 5;

type Item = { mark: StepMark } | { gap: true };

/** Pallini di una sequenza lunga: i primi, un'interruzione e gli ultimi. */
export function collapsePath(path: StepMark[], max = MAX, edge = EDGE): Item[] {
  const items = path.map((mark) => ({ mark }));
  if (path.length <= max) return items;
  return [...items.slice(0, edge), { gap: true }, ...items.slice(-edge)];
}

/**
 * Percorso di un task nell'elenco: i passi del workflow (fatti nel colore della modalità, da
 * fare in grigio) o i turni di una richiesta libera.
 */
@Component({
  selector: 'jk-run-path',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'inline-flex w-fit shrink-0 items-center',
    role: 'img',
    '[attr.aria-label]': 'label()',
    '[title]': 'label()',
  },
  template: `
    @for (item of items(); track $index; let i = $index) {
      @if (i > 0) {
        <!-- Tratto che lega i passi: colorato fin dove si è arrivati. -->
        <span class="h-0.5 w-2.5" [class]="lineCls(i)"></span>
      }
      @if ('gap' in item) {
        <span class="px-0.5 text-[10px] leading-none text-faint">…</span>
      } @else {
        <span class="size-2 shrink-0 rounded-full" [class]="cls(item.mark)"></span>
      }
    }
  `,
})
export class RunPath {
  private readonly i18n = inject(I18n);
  readonly path = input.required<StepMark[]>();
  readonly tone = input.required<Tone>();
  /** Richiesta libera: i pallini sono i turni, non i passi di un workflow. */
  readonly direct = input(false);

  protected readonly items = computed(() => collapsePath(this.path()));

  protected readonly label = computed(() => {
    const p = this.path();
    const failed = p.filter((m) => m === 'failed').length;
    const text = this.direct()
      ? this.i18n.t('path.turns', { n: p.filter((m) => m !== 'current').length })
      : this.i18n.t('path.steps', {
          n: p.filter((m) => m === 'done' || m === 'skipped' || m === 'failed').length,
          total: p.length,
        });
    return failed ? `${text} · ${this.i18n.t('path.failed', { n: failed })}` : text;
  });

  /** Il tratto prima dell'elemento `i` è colorato se il percorso è già arrivato lì. */
  protected lineCls(i: number): string {
    const items = this.items();
    const reached = (j: number): boolean => {
      const it = items[j];
      if (!it) return false;
      return 'gap' in it ? reached(j + 1) : it.mark !== 'pending';
    };
    return reached(i) ? `${this.tone().dot} opacity-60` : 'bg-zinc-300 dark:bg-zinc-700';
  }

  protected cls(mark: StepMark): string {
    switch (mark) {
      case 'done':
        return this.tone().dot;
      case 'current':
        return `${this.tone().dot} animate-pulse ring-2 ring-offset-1 ring-offset-surface ${this.tone().ring}`;
      case 'failed':
        return 'bg-red-500';
      case 'skipped':
        return `border ${this.tone().ringBorder}`;
      case 'pending':
        return 'bg-zinc-300 dark:bg-zinc-700';
    }
  }
}
