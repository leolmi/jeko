import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { Answer, PromptRecord } from '@jeko/shared';
import { I18n, type I18nKey } from '../core/i18n';
import { Icon, type IconName } from '../ui/icon';

/** Una richiesta all'utente nel filo della chat: aperta (con i comandi) o già chiusa. */
@Component({
  selector: 'jk-prompt-card',
  imports: [FormsModule, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let p = record().prompt;
    @let pending = record().status === 'pending';
    <div
      class="rounded-xl border bg-surface"
      [class]="pending ? 'border-amber-400/60 shadow-sm dark:border-amber-500/40' : 'border-line'"
    >
      <div class="flex items-center gap-2 px-4 pt-3 text-xs font-medium text-muted">
        <jk-icon [name]="head().icon" [size]="16" [class]="pending ? 'text-amber-500' : ''" />
        <span>{{ i18n.t(head().label) }}</span>
        <span class="font-mono text-faint">· {{ p.stepId }}</span>
      </div>

      <div class="px-4 pt-1.5 pb-4">
        @switch (p.kind) {
          @case ('ask') {
            <p class="text-sm leading-relaxed whitespace-pre-wrap">{{ p.question }}</p>
            @if (pending) {
              @if (p.enum) {
                <div class="mt-3 flex flex-wrap gap-2">
                  @for (opt of p.enum; track opt) {
                    <button
                      type="button"
                      class="jk-btn-outline"
                      [disabled]="busy()"
                      (click)="send({ kind: 'ask', value: opt })"
                    >
                      {{ opt }}
                    </button>
                  }
                </div>
              } @else {
                <form class="mt-3 flex gap-2" (ngSubmit)="sendText()">
                  <input
                    class="jk-input"
                    name="text"
                    autocomplete="off"
                    [attr.aria-label]="p.question"
                    [placeholder]="p.default ? i18n.t('prompt.default', { value: p.default }) : ''"
                    [(ngModel)]="text"
                  />
                  <button
                    type="submit"
                    class="jk-btn-primary"
                    [disabled]="busy() || (p.required && !text().trim() && !p.default)"
                  >
                    <jk-icon name="send" [size]="16" />
                    {{ i18n.t('prompt.answer') }}
                  </button>
                </form>
              }
              @if (!p.required) {
                <button
                  type="button"
                  class="jk-btn-ghost mt-2 -ml-2"
                  [disabled]="busy()"
                  (click)="send({ kind: 'ask', value: null })"
                >
                  <jk-icon name="skip_next" [size]="16" />
                  {{ i18n.t('prompt.skip') }}
                </button>
              }
            }
          }

          @case ('approve') {
            <p class="text-sm leading-relaxed whitespace-pre-wrap">{{ p.message }}</p>
            @if (p.actions?.length) {
              <div class="mt-2 flex flex-wrap gap-1.5">
                @for (a of p.actions; track a) {
                  <span class="rounded-md bg-subtle px-1.5 py-0.5 font-mono text-xs text-muted">{{
                    a
                  }}</span>
                }
              </div>
            }
            @if (pending) {
              <textarea
                class="jk-input mt-3 resize-none"
                rows="2"
                name="note"
                [attr.aria-label]="i18n.t('prompt.note')"
                [placeholder]="i18n.t('prompt.note')"
                [(ngModel)]="text"
              ></textarea>
              <div class="mt-3 flex gap-2">
                <button
                  type="button"
                  class="jk-btn-primary"
                  [disabled]="busy()"
                  (click)="approve(true)"
                >
                  <jk-icon name="check" [size]="16" />
                  {{ i18n.t('prompt.approve') }}
                </button>
                <button
                  type="button"
                  class="jk-btn-outline"
                  [disabled]="busy()"
                  (click)="approve(false)"
                >
                  <jk-icon name="close" [size]="16" />
                  {{ i18n.t('prompt.reject') }}
                </button>
              </div>
            }
          }

          @case ('review') {
            <pre
              class="max-h-72 overflow-auto rounded-lg bg-subtle p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-fg"
              >{{ p.output }}</pre>
            @if (pending) {
              <textarea
                class="jk-input mt-3 resize-none"
                rows="2"
                name="feedback"
                [attr.aria-label]="i18n.t('prompt.feedback')"
                [placeholder]="i18n.t('prompt.feedback')"
                [(ngModel)]="text"
              ></textarea>
              <div class="mt-3 flex gap-2">
                <button
                  type="button"
                  class="jk-btn-primary"
                  [disabled]="busy()"
                  (click)="send({ kind: 'review', ok: true })"
                >
                  <jk-icon name="check" [size]="16" />
                  {{ i18n.t('prompt.ok') }}
                </button>
                <button
                  type="button"
                  class="jk-btn-outline"
                  [disabled]="busy() || !text().trim()"
                  (click)="send({ kind: 'review', ok: false, feedback: text().trim() })"
                >
                  {{ i18n.t('prompt.changes') }}
                </button>
              </div>
            }
          }
        }

        @if (!pending) {
          <p class="mt-3 flex items-center gap-1.5 text-xs text-muted">
            @if (record().status === 'superseded') {
              <jk-icon name="block" [size]="14" />
              {{ i18n.t('prompt.superseded') }}
            } @else {
              <jk-icon name="check_circle" [size]="14" class="text-emerald-500" />
              {{ summary() }}
            }
          </p>
        }
        @if (error()) {
          <p class="mt-2 text-xs text-red-600 dark:text-red-400">{{ i18n.t('prompt.error') }}</p>
        }
      </div>
    </div>
  `,
})
export class PromptCard {
  protected readonly i18n = inject(I18n);
  readonly record = input.required<PromptRecord>();
  readonly busy = input(false);
  readonly error = input(false);
  readonly answer = output<Answer>();
  protected readonly text = signal('');

  protected readonly head = computed((): { icon: IconName; label: I18nKey } => {
    const p = this.record().prompt;
    if (p.kind === 'review') return { icon: 'visibility', label: 'prompt.review' };
    if (p.kind === 'approve')
      return p.reason === 'policy'
        ? { icon: 'shield', label: 'prompt.policy' }
        : { icon: 'shield', label: 'prompt.gate' };
    return p.stepId.startsWith('input:')
      ? { icon: 'help', label: 'prompt.input' }
      : { icon: 'help', label: 'prompt.ask' };
  });

  protected readonly summary = computed(() => {
    const a = this.record().answer;
    const t = (k: I18nKey) => this.i18n.t(k);
    if (!a) return t('prompt.answered');
    switch (a.kind) {
      case 'ask':
        return `${t('prompt.answered')}: ${a.value ?? t('prompt.skipped')}`;
      case 'approve':
        return (
          t(a.approved ? 'prompt.approved' : 'prompt.rejected') + (a.note ? ` — ${a.note}` : '')
        );
      case 'review':
        return a.ok ? t('prompt.reviewOk') : `${t('prompt.reviewChanges')}: ${a.feedback ?? ''}`;
    }
  });

  protected send(answer: Answer): void {
    this.answer.emit(answer);
  }

  protected sendText(): void {
    const p = this.record().prompt;
    const value = this.text().trim();
    if (p.kind !== 'ask') return;
    this.send({ kind: 'ask', value: value || (p.default ?? null) });
  }

  protected approve(approved: boolean): void {
    const note = this.text().trim();
    this.send({ kind: 'approve', approved, ...(note && { note }) });
  }
}
