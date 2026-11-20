import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  input,
  model,
  viewChild,
} from '@angular/core';
import type { Issue } from '@jeko/shared';

/** Editor dello YAML: numeri di riga, righe con errori evidenziate, Tab = due spazi. */
@Component({
  selector: 'jk-yaml-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-h-0 overflow-hidden rounded-xl border border-line bg-surface' },
  template: `
    <div
      #gutter
      class="shrink-0 overflow-hidden border-r border-line bg-subtle/50 py-3 text-right font-mono text-xs leading-5 text-faint select-none"
      aria-hidden="true"
    >
      @for (n of lines(); track n) {
        <span
          class="block px-2"
          [class]="errorLines().has(n) ? 'bg-red-500/15 text-red-600 dark:text-red-400' : ''"
          >{{ n }}</span
        >
      }
      <!-- Spazio per la barra di scorrimento orizzontale della textarea. -->
      <span class="block h-4"></span>
    </div>
    <textarea
      #area
      class="block min-h-0 flex-1 resize-none bg-transparent px-3 py-3 font-mono text-xs leading-5 whitespace-pre outline-none"
      spellcheck="false"
      autocomplete="off"
      wrap="off"
      [attr.aria-label]="label()"
      [readOnly]="readonly()"
      [value]="value()"
      (input)="value.set($any($event.target).value)"
      (scroll)="sync()"
      (keydown.tab)="indent($event)"
    ></textarea>
  `,
})
export class YamlEditor {
  readonly value = model('');
  readonly issues = input<Issue[]>([]);
  readonly label = input('YAML');
  readonly readonly = input(false);

  private readonly area = viewChild.required<ElementRef<HTMLTextAreaElement>>('area');
  private readonly gutter = viewChild.required<ElementRef<HTMLElement>>('gutter');

  protected readonly lines = computed(() =>
    Array.from({ length: this.value().split('\n').length }, (_, i) => i + 1),
  );
  protected readonly errorLines = computed(
    () => new Set(this.issues().flatMap((i) => (i.line ? [i.line] : []))),
  );

  protected sync(): void {
    this.gutter().nativeElement.scrollTop = this.area().nativeElement.scrollTop;
  }

  protected indent(e: Event): void {
    if (this.readonly()) return;
    e.preventDefault();
    const el = this.area().nativeElement;
    const { selectionStart: s, selectionEnd: end } = el;
    el.setRangeText('  ', s, end, 'end');
    this.value.set(el.value);
  }

  /** Porta il cursore all'inizio della riga e la seleziona (da un errore cliccato). */
  goTo(line: number): void {
    const el = this.area().nativeElement;
    const rows = el.value.split('\n');
    const start = rows.slice(0, line - 1).reduce((n, r) => n + r.length + 1, 0);
    el.focus();
    el.setSelectionRange(start, start + (rows[line - 1]?.length ?? 0));
    // Circa a metà altezza: 20px per riga (leading-5).
    el.scrollTop = Math.max(0, (line - 1) * 20 - el.clientHeight / 2);
    this.sync();
  }
}
