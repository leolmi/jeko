import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
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
import { Router, RouterLink } from '@angular/router';
import {
  DIRECT_FOLLOW_UP,
  DIRECT_WORKFLOW,
  FINAL_STATUSES,
  type Answer,
  type RunDetail,
  type TaskProcess,
} from '@jeko/shared';
import { I18n, type I18nKey } from '../core/i18n';
import { Realtime } from '../core/realtime';
import { Runs } from '../core/runs';
import { Icon } from '../ui/icon';
import { ModeBadge, runTone } from '../ui/mode-tone';
import { Status } from '../ui/status';
import { PromptCard } from './prompt-card';
import { buildBreakdown } from './breakdown';
import { buildTimeline } from './timeline';
import { UsageBar } from './usage-bar';

/** Filo di una run: la richiesta, l'avanzamento e le domande a cui rispondere. */
@Component({
  selector: 'jk-thread',
  imports: [NgTemplateOutlet, RouterLink, Icon, Status, PromptCard, ModeBadge, UsageBar],
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
            @if (r.usage; as u) {
              @let use = i18n.usage(u);
              <span class="cursor-help" [title]="use.detail">· {{ use.short }}</span>
            }
          </p>
          @if (origin(); as o) {
            <p class="truncate text-xs text-muted">
              {{ i18n.t('thread.from') }}
              <a class="underline hover:text-fg" [routerLink]="['/runs', o.id]">{{ o.request }}</a>
            </p>
          }
        </div>
        <jk-mode-badge [tone]="runTone(r)" />
        <jk-status [status]="r.status" />
        @if (!final() && alive().length > 0) {
          <button
            type="button"
            class="jk-btn-ghost"
            [title]="i18n.t('thread.processes.title')"
            [disabled]="stopping()"
            (click)="stopProcesses()"
          >
            <jk-icon name="terminal" [size]="16" />
            {{ i18n.t('thread.processes', { n: alive().length }) }}
          </button>
        }
        @if (!final()) {
          <button type="button" class="jk-btn-ghost" (click)="cancel()">
            <jk-icon name="stop" [size]="16" />
            {{ i18n.t('thread.cancel') }}
          </button>
        } @else {
          <button
            type="button"
            class="jk-btn-danger py-1"
            [title]="i18n.t('tasks.delete')"
            [attr.aria-label]="i18n.t('tasks.delete')"
            (click)="remove()"
          >
            <jk-icon name="delete" [size]="18" />
          </button>
        }
      </header>
      @if (breakdown(); as b) {
        <jk-usage-bar class="border-b border-line px-6 py-2.5" [breakdown]="b" />
      }

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
                      @if (item.state === 'skipped' && item.output) {
                        <span class="text-xs text-faint">· {{ item.output }}</span>
                      }
                      @if (item.usage; as u) {
                        @let use = i18n.usage(u);
                        <span class="ml-auto cursor-help text-xs text-faint" [title]="use.detail">{{
                          use.short
                        }}</span>
                      }
                      <span
                        class="text-xs text-faint"
                        [class.ml-auto]="!item.usage"
                        [title]="i18n.dateTime(item.at)"
                        >{{ i18n.time(item.at) }}</span
                      >
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
                    @if (direct() && item.state !== 'running' && item.output) {
                      <!-- Task diretto: l'uscita è la risposta di claude, da leggere subito. -->
                      <pre
                        class="mt-2 ml-7 rounded-2xl rounded-bl-md border border-line bg-surface px-4 py-3 font-sans text-sm leading-relaxed whitespace-pre-wrap text-fg"
                        >{{ item.output }}</pre>
                    } @else if (item.output && item.state !== 'skipped') {
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
          @if (followUp(); as p) {
            <li class="mt-2 flex items-center gap-3 text-xs text-muted">
              <span class="h-px flex-1 bg-line"></span>
              <span>{{ i18n.t('thread.followUp') }}</span>
              <button
                type="button"
                class="jk-btn-ghost px-2 py-1 text-xs"
                [disabled]="sending() === p.id"
                (click)="answer(p.id, { kind: 'ask', value: null })"
              >
                <jk-icon name="check" [size]="14" />
                {{ i18n.t('thread.followUp.close') }}
              </button>
              <span class="h-px flex-1 bg-line"></span>
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
  /** Task diretto, senza workflow di sviluppo: l'uscita si mostra come risposta. */
  protected readonly direct = computed(() => this.run()?.workflow === DIRECT_WORKFLOW);
  protected readonly runTone = runTone;
  /** Task diretto in attesa del messaggio seguente (lo scrive l'utente nel composer). */
  protected readonly followUp = computed(() => {
    const r = this.run();
    if (!r || FINAL_STATUSES.includes(r.status)) return null;
    return (
      r.prompts.find((p) => p.status === 'pending' && p.prompt.stepId === DIRECT_FOLLOW_UP) ?? null
    );
  });
  private readonly runs = inject(Runs);
  /** Task da cui questo continua, se esiste ancora. */
  protected readonly origin = computed(() => {
    const from = this.run()?.from;
    return from ? (this.runs.list().find((r) => r.id === from) ?? null) : null;
  });
  private readonly router = inject(Router);
  protected readonly sending = signal<string | null>(null);
  protected readonly failed = signal<string | null>(null);
  protected readonly timeline = computed(() => {
    const r = this.run();
    return r ? buildTimeline(r) : [];
  });
  /** Dove ha speso la run, passo per passo. */
  protected readonly breakdown = computed(() => buildBreakdown(this.timeline()));
  protected readonly final = computed(() => {
    const r = this.run();
    return !r || FINAL_STATUSES.includes(r.status);
  });
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  /** Processi lasciati attivi dal task (strumento start_process di claude). */
  protected readonly processes = signal<TaskProcess[]>([]);
  protected readonly alive = computed(() => this.processes().filter((p) => p.alive));
  protected readonly stopping = signal(false);

  constructor() {
    effect(() => this.load(this.id()));
    // A task aperto si guarda quali processi ha lasciato attivi, a ogni cambio di stato (es. a
    // fine turno); a task chiuso li ha già chiusi Jeko.
    const openRun = computed(() => {
      const r = this.run();
      return r && !FINAL_STATUSES.includes(r.status) ? `${r.id}|${r.status}` : null;
    });
    effect(() => {
      const key = openRun();
      if (key) this.loadProcesses(key.split('|')[0]!);
      else this.processes.set([]);
    });
    effect(() => {
      const p = this.followUp();
      const r = this.run();
      this.runs.followUp.set(p && r ? { runId: r.id, promptId: p.id, cwd: r.cwd } : null);
    });
    effect(() => {
      const r = this.run();
      if (!r || !FINAL_STATUSES.includes(r.status)) return this.runs.closed.set(null);
      // Si continua da un task diretto se claude ha avuto almeno un turno (c'è la sessione).
      const session = r.events.some((e) => e.event.type === 'state' && !!e.event.state.sessionId);
      this.runs.closed.set({ id: r.id, cwd: r.cwd, fork: this.direct() && session });
    });

    const rt = inject(Realtime);
    const offMsg = rt.on((msg) => {
      const r = this.run();
      if (!r || !('runId' in msg) || msg.runId !== r.id) return;
      switch (msg.type) {
        case 'run.status':
          return this.run.set({ ...r, status: msg.status, error: msg.error });
        case 'run.event':
          if (r.events.some((e) => e.seq === msg.record.seq)) return;
          return this.run.set({
            ...r,
            events: [...r.events, msg.record],
            // Lo stato salvato porta il consumo della run finora.
            ...(msg.record.event.type === 'state' && {
              usage: msg.record.event.state.usage ?? null,
            }),
          });
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
      this.runs.followUp.set(null);
      this.runs.closed.set(null);
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

  /** Elimina il task concluso con la sua storia e torna ai task del progetto. */
  protected remove(): void {
    const r = this.run();
    if (!r) return;
    const ask = this.i18n.t('tasks.delete.confirm', { request: r.request.slice(0, 80) });
    if (!globalThis.confirm(ask)) return;
    this.runs
      .remove([r.id])
      .then(() => this.router.navigate(['/']))
      .catch(() => undefined);
  }

  private loadProcesses(id: string): void {
    this.http.get<TaskProcess[]>(`/api/runs/${id}/processes`).subscribe({
      next: (list) => {
        if (this.run()?.id === id) this.processes.set(list);
      },
      error: () => undefined,
    });
  }

  /** Chiude, dopo conferma, i processi del task ancora attivi (elenco riletto al momento). */
  protected async stopProcesses(): Promise<void> {
    const r = this.run();
    if (!r || this.stopping()) return;
    const fail = (e: unknown) => {
      const error = e instanceof HttpErrorResponse ? (e.error?.message ?? e.message) : String(e);
      globalThis.alert(this.i18n.t('thread.processes.failed', { error }));
    };
    this.stopping.set(true);
    try {
      const list = await firstValueFrom(
        this.http.get<TaskProcess[]>(`/api/runs/${r.id}/processes`),
      );
      this.processes.set(list);
      const alive = list.filter((p) => p.alive);
      if (alive.length === 0) return globalThis.alert(this.i18n.t('thread.processes.none'));
      const lines = alive.map((p) => `• PID ${p.pid}: ${p.command}`).join('\n');
      if (!globalThis.confirm(this.i18n.t('thread.processes.confirm', { list: lines }))) return;
      this.processes.set(
        await firstValueFrom(this.http.post<TaskProcess[]>(`/api/runs/${r.id}/processes/stop`, {})),
      );
    } catch (e) {
      fail(e);
    } finally {
      this.stopping.set(false);
    }
  }

  protected cancel(): void {
    const r = this.run();
    if (r) this.http.post(`/api/runs/${r.id}/cancel`, {}).subscribe();
  }

  protected finishedLabel(status: string): I18nKey {
    return `thread.finished.${status}` as I18nKey;
  }
}
