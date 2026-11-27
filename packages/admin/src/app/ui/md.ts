import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { renderMarkdown } from './markdown';

/** Testo in markdown reso leggibile (risposte di claude, note…). */
@Component({
  selector: 'jk-md',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'jk-md block break-words', '[innerHTML]': 'html()' },
  template: '',
})
export class Md {
  readonly text = input.required<string>();
  protected readonly html = computed(() => renderMarkdown(this.text()));
}
