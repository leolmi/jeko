import { HttpClient } from '@angular/common/http';
import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FINAL_STATUSES, type Answer, type RunDetail } from '@jeko/shared';
import { I18n, type I18nKey } from '../core/i18n';
import { Realtime } from '../core/realtime';
import { Icon } from '../ui/icon';
import { Status } from '../ui/status';
import { PromptCard } from './prompt-card';
import { buildTimeline } from './timeline';

/** Filo di una run: la richiesta, l'avanzamento e le domande a cui rispondere. */
@Component({
  selector: 'jk-thread',
  imports: [NgTemplateOutlet, RouterLink, Icon, Status, PromptCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex h-full flex-col' },
  template: `
    @if (missing()) {
      <p class="m-auto text-sm text-muted">{{ i18n.t('thread.notFound') }}</p>
    } @else if (run(); as r) {
      <header class="flex items-center gap-3 border-b border-line px-6 py-3">
        <a
          routerLink="/"
          class="jk-btn-ghost -ml-2 px-1.5"
          [title]="i18n.t('tasks.back')"
          [attr.aria-label]="i18n.t('tasks.back')"
        >
          <jk-icon name="arrow_back" [size]="18" />
        </a>
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium">{{ r.request }}</p>
          <p class="font-mono text-xs text-faint">
            {{ r.workflow }}@{{ r.version }} · {{ r.mode }}
          </p>
        </div>
        <jk-status [status]="r.status" />
        @if (!final()) {
          <button type="button" class="jk-btn-ghost" (click)="cancel()">
            <jk-icon name="stop" [size]="16" />
            {{ i18n.t('thread.cancel') }}
          </button>
        }
      </header>

      <div #scroller class="flex-1 overflow-y-auto">
        <ol class="mx-auto flex max-w-3xl flex-col gap-3 px-6 py-8">
          @for (item of timeline(); track item.key) {
            <li>
              @switch (item.kind) {
                @case ('request') {
                  <div class="flex justify-end">
                    <div
                      class="max-w-[85%] rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-accent-fg"
                    >
                      <p class="text-sm leading-relaxed whitespace-pre-wrap">{{ item.text }}</p>
                    </div>
                  </div>
                }
                @case ('step') {
                  <div class="group">
                    <div class="flex items-center gap-2.5 text-sm">
                      @switch (item.state) {
                        @case ('running') {
                          <span class="flex size-5 items-center justify-center">
                            <span class="size-2 animate-pulse rounded-full bg-sky-500"></span>
                          </span>
                        }
                        @case ('ok') {
                          <jk-icon name="check_circle" [size]="20" class="text-emerald-500" />
                        }
                        @case ('failed') {
                          <jk-icon name="error" [size]="20" class="text-red-500" />
                        }
                        @case ('skipped') {
                          <jk-icon name="skip_next" [size]="20" class="text-faint" />
                        }
                      }
                      <span
                        [class]="item.state === 'skipped' ? 'text-faint line-through' : 'text-fg'"
                        [class.font-mono]="!item.title"
                        >{{ item.title ?? item.stepId }}</span
                      >
                      @if (item.title) {
                        <span class="font-mono text-xs text-faint">{{ item.stepId }}</span>
                      }
                      @if (item.state === 'running') {
                        <span class="text-xs text-muted">{{ i18n.t('thread.step.running') }}…</span>
                      }
                      <span class="ml-auto text-xs text-faint">{{ i18n.time(item.at) }}</span>
                    </div>
                    @if (item.state === 'running' && item.activity.length > 0) {
                      <ul class="mt-1.5 ml-7 flex flex-col gap-1">
                        @for (a of item.activity.slice(-3); track a.key) {
                          <li>
                            <ng-container *ngTemplateOutlet="act; context: { $implicit: a }" />
                          </li>
                        }
                      </ul>
                    }
                    @if (item.activity.length > (item.state === 'running' ? 3 : 0)) {
                      <details class="mt-1 ml-7">
                        <summary
                          class="cursor-pointer text-xs text-muted select-none hover:text-fg"
                        >
                          {{ i18n.t('thread.activity') }} ({{ item.activity.length }})
                        </summary>
                        <ul class="mt-1.5 flex max-h-80 flex-col gap-1 overflow-auto">
                          @for (a of item.activity; track a.key) {
                            <li>
                              <ng-container *ngTemplateOutlet="act; context: { $implicit: a }" />
                            </li>
                          }
                        </ul>
                      </details>
                    }
                    @if (item.output && item.output.length > 0) {
                      <details class="mt-1 ml-7">
                        <summary
                          class="cursor-pointer text-xs text-muted select-none hover:text-fg"
                        >
                          {{ i18n.t('thread.output') }}
                        </summary>
                        <pre
                          class="mt-1.5 max-h-80 overflow-auto rounded-lg bg-subtle p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap"
                          >{{ item.output }}</pre>
                      </details>
                    }
                  </div>
                }
                @case ('policy') {
                  <div class="ml-7 flex items-center gap-2 text-xs text-muted">
                    <jk-icon name="shield" [size]="14" />
                    <span>{{ i18n.t('thread.policy') }}</span>
                    <code class="truncate rounded bg-subtle px-1.5 py-0.5 font-mono">{{
                      item.command
                    }}</code>
                    <span
                      [class]="
                        item.approved
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-red-600 dark:text-red-400'
                      "
                    >
                      {{
                        i18n.t(item.approved ? 'thread.policy.approved' : 'thread.policy.denied')
                      }}
                    </span>
                  </div>
                }
                @case ('prompt') {
                  <jk-prompt-card
                    [record]="item.record"
                    [stepTitle]="item.stepTitle"
                    [busy]="sending() === item.record.id"
                    [error]="failed() === item.record.id"
                    (answer)="answer(item.record.id, $event)"
                  />
                }
                @case ('finished') {
                  <div class="mt-4 flex items-center gap-3 text-xs text-muted">
                    <span class="h-px flex-1 bg-line"></span>
                    <span>{{ i18n.t(finishedLabel(item.status)) }}</span>
                    <span class="h-px flex-1 bg-line"></span>
                  </div>
                  @if (item.error && item.status !== 'cancelled') {
                    <p class="mt-2 text-center text-xs text-red-600 dark:text-red-400">
                      {{ item.error }}
                    </p>
                  }
                }
              }
            </li>
          }
        </ol>
      </div>
    }

    <ng-template #act let-a>
      @if (a.kind === 'tool') {
        <div class="flex min-w-0 items-center gap-2 text-xs text-muted">
          <jk-icon name="code" [size]="14" class="shrink-0 text-faint" />
          <span class="shrink-0 font-mono text-fg">{{ a.tool }}</span>
          <span class="truncate font-mono">{{ a.text }}</span>
        </div>
      } @else {
        <p class="line-clamp-3 text-xs leading-relaxed whitespace-pre-wrap text-muted">
          {{ a.text }}
        </p>
      }
    </ng-template>
  `,
})
export class Thread {
  protected readonly i18n = inject(I18n);
  private readonly http = inject(HttpClient);
  readonly id = input.required<string>();

  protected readonly run = signal<RunDetail | null>(null);
  protected readonly missing = signal(false);
  protected readonly sending = signal<string | null>(null);
  protected readonly failed = signal<string | null>(null);
  protected readonly timeline = computed(() => {
    const r = this.run();
    return r ? buildTimeline(r) : [];
  });
  protected readonly final = computed(() => {
    const r = this.run();
    return !r || FINAL_STATUSES.includes(r.status);
  });
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  constructor() {
    effect(() => this.load(this.id()));

    const rt = inject(Realtime);
    const offMsg = rt.on((msg) => {
      const r = this.run();
      if (!r || !('runId' in msg) || msg.runId !== r.id) return;
      switch (msg.type) {
        case 'run.status':
          return this.run.set({ ...r, status: msg.status, error: msg.error });
        case 'run.event':
          if (r.events.some((e) => e.seq === msg.record.seq)) return;
          return this.run.set({ ...r, events: [...r.events, msg.record] });
        case 'run.prompt': {
          const others = r.prompts.filter((p) => p.id !== msg.prompt.id);
          return this.run.set({ ...r, prompts: [...others, msg.prompt] });
        }
      }
    });
    const offReconnect = rt.onReconnect(() => this.load(this.id()));
    inject(DestroyRef).onDestroy(() => {
      offMsg();
      offReconnect();
    });

    // Resta in fondo al filo quando arriva qualcosa di nuovo.
    afterRenderEffect(() => {
      this.timeline();
      const el = this.scroller()?.nativeElement;
      el?.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    });
  }

  private load(id: string): void {
    this.missing.set(false);
    this.http.get<RunDetail>(`/api/runs/${id}`).subscribe({
      next: (r) => this.run.set(r),
      error: () => {
        this.run.set(null);
        this.missing.set(true);
      },
    });
  }

  protected answer(promptId: string, answer: Answer): void {
    const r = this.run();
    if (!r) return;
    this.sending.set(promptId);
    this.failed.set(null);
    this.http.post(`/api/runs/${r.id}/prompts/${promptId}`, answer).subscribe({
      next: () => this.sending.set(null),
      error: () => {
        this.sending.set(null);
        this.failed.set(promptId);
      },
    });
  }

  protected cancel(): void {
    const r = this.run();
    if (r) this.http.post(`/api/runs/${r.id}/cancel`, {}).subscribe();
  }

  protected finishedLabel(status: string): I18nKey {
    return `thread.finished.${status}` as I18nKey;
  }
}
