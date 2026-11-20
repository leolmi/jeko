import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { I18n, type I18nKey } from '../core/i18n';
import { blocking, serverChecks, Setup } from '../core/setup';
import { Icon } from '../ui/icon';
import { Prefs } from '../ui/prefs';
import { CheckList } from './check-list';

type StepId = 'welcome' | 'server' | 'runner' | 'env' | 'done';
const STEPS: StepId[] = ['welcome', 'server', 'runner', 'env', 'done'];
const RUNNER_CMD = 'npm run dev:runner';

/** Primo avvio a passi: preferenze, server, runner, ambiente del runner. */
@Component({
  selector: 'jk-wizard',
  imports: [Icon, Prefs, CheckList],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex min-h-screen flex-col items-center bg-bg px-6 py-12' },
  template: `
    <div class="w-full max-w-xl">
      <div class="flex items-center justify-between">
        <span class="font-mono text-lg font-semibold tracking-tight">jeko</span>
        <span class="text-xs text-faint">{{ i18n.t('setup.title') }}</span>
      </div>

      <ol class="mt-8 flex items-center gap-2" [attr.aria-label]="i18n.t('setup.title')">
        @for (s of steps; track s; let i = $index) {
          <li
            class="flex flex-1 items-center gap-2"
            [attr.aria-current]="i === index() ? 'step' : null"
          >
            <span
              class="flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium transition-colors"
              [class]="
                i < index()
                  ? 'bg-emerald-500 text-white'
                  : i === index()
                    ? 'bg-accent text-accent-fg'
                    : 'bg-subtle text-faint'
              "
            >
              @if (i < index()) {
                <jk-icon name="check" [size]="14" />
              } @else {
                {{ i + 1 }}
              }
            </span>
            <span
              class="hidden text-xs sm:inline"
              [class]="i === index() ? 'text-fg' : 'text-faint'"
              >{{ i18n.t(stepLabel(s)) }}</span
            >
            @if (i < steps.length - 1) {
              <span class="h-px flex-1 bg-line"></span>
            }
          </li>
        }
      </ol>

      <section class="mt-10 min-h-80">
        @switch (step()) {
          @case ('welcome') {
            <h1 class="text-2xl font-bold tracking-tight">{{ i18n.t('setup.welcome.title') }}</h1>
            <p class="mt-2 text-sm leading-relaxed text-muted">
              {{ i18n.t('setup.welcome.body') }}
            </p>
            <div class="mt-8"><jk-prefs /></div>
          }
          @case ('server') {
            <h1 class="text-2xl font-bold tracking-tight">{{ i18n.t('setup.server.title') }}</h1>
            <p class="mt-2 text-sm leading-relaxed text-muted">{{ i18n.t('setup.server.body') }}</p>
            <div class="mt-6"><jk-check-list [checks]="server()" /></div>
          }
          @case ('runner') {
            <h1 class="text-2xl font-bold tracking-tight">{{ i18n.t('setup.runner.title') }}</h1>
            <p class="mt-2 text-sm leading-relaxed text-muted">{{ i18n.t('setup.runner.body') }}</p>
            <p class="mt-6 text-xs text-muted">{{ i18n.t('setup.runner.how') }}</p>
            <div
              class="mt-1.5 flex items-center gap-2 rounded-lg border border-line bg-surface py-1.5 pr-1.5 pl-3"
            >
              <code class="flex-1 font-mono text-sm">{{ runnerCmd }}</code>
              <button type="button" class="jk-btn-ghost" (click)="copy()">
                <jk-icon [name]="copied() ? 'check' : 'content_copy'" [size]="16" />
                {{ i18n.t(copied() ? 'setup.copied' : 'setup.copy') }}
              </button>
            </div>
            <div class="mt-6 flex items-center gap-2.5 text-sm" aria-live="polite">
              @if (runner().connected) {
                <jk-icon name="check_circle" [size]="20" class="text-emerald-500" />
                {{ i18n.t('setup.runner.connected', { id: runner().runnerId ?? '' }) }}
                @if (runner().version) {
                  <span class="font-mono text-xs text-faint">v{{ runner().version }}</span>
                }
              } @else {
                <span class="flex size-5 items-center justify-center">
                  <span class="size-2 animate-pulse rounded-full bg-amber-500"></span>
                </span>
                <span class="text-muted">{{ i18n.t('setup.runner.waiting') }}</span>
              }
            </div>
          }
          @case ('env') {
            <div class="flex items-start justify-between gap-4">
              <div>
                <h1 class="text-2xl font-bold tracking-tight">{{ i18n.t('setup.env.title') }}</h1>
                <p class="mt-2 text-sm leading-relaxed text-muted">
                  {{ i18n.t('setup.env.body') }}
                </p>
              </div>
              <button
                type="button"
                class="jk-btn-outline shrink-0"
                [disabled]="rechecking() || !runner().connected"
                (click)="recheck()"
              >
                <jk-icon name="refresh" [size]="16" [class]="rechecking() ? 'animate-spin' : ''" />
                {{ i18n.t('setup.recheck') }}
              </button>
            </div>
            <div class="mt-6">
              @if (runner().checks; as checks) {
                <jk-check-list [checks]="checks" />
              } @else {
                <p class="flex items-center gap-2.5 text-sm text-muted">
                  <span class="size-2 animate-pulse rounded-full bg-sky-500"></span>
                  {{ i18n.t(runner().connected ? 'setup.env.waiting' : 'setup.runner.waiting') }}
                </p>
              }
            </div>
          }
          @case ('done') {
            <div class="flex size-12 items-center justify-center rounded-full bg-emerald-500/10">
              <jk-icon name="check" [size]="28" class="text-emerald-500" />
            </div>
            <h1 class="mt-5 text-2xl font-bold tracking-tight">{{ i18n.t('setup.done.title') }}</h1>
            <p class="mt-2 text-sm leading-relaxed text-muted">{{ i18n.t('setup.done.body') }}</p>
          }
        }
      </section>

      <footer class="mt-10 flex items-center gap-3 border-t border-line pt-6">
        @if (index() > 0) {
          <button type="button" class="jk-btn-ghost" (click)="go(-1)">
            <jk-icon name="arrow_back" [size]="16" />
            {{ i18n.t('setup.back') }}
          </button>
        }
        <p
          class="flex-1 text-right text-xs"
          [class]="
            blocked() ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'
          "
        >
          @if (blocked() && step() !== 'runner') {
            {{ i18n.t('setup.blocked') }}
          } @else if (warned()) {
            {{ i18n.t('setup.warnings') }}
          }
        </p>
        @if (step() === 'done') {
          <button type="button" class="jk-btn-primary" [disabled]="finishing()" (click)="finish()">
            {{ i18n.t('setup.start') }}
            <jk-icon name="arrow_forward" [size]="16" />
          </button>
        } @else {
          <button type="button" class="jk-btn-primary" [disabled]="blocked()" (click)="go(1)">
            {{ i18n.t('setup.next') }}
            <jk-icon name="arrow_forward" [size]="16" />
          </button>
        }
      </footer>
    </div>
  `,
})
export class Wizard {
  protected readonly i18n = inject(I18n);
  private readonly setup = inject(Setup);

  protected readonly steps = STEPS;
  protected readonly runnerCmd = RUNNER_CMD;
  protected readonly index = signal(0);
  protected readonly step = computed(() => STEPS[this.index()]!);
  protected readonly copied = signal(false);
  protected readonly rechecking = signal(false);
  protected readonly finishing = signal(false);

  protected readonly server = computed(() => {
    const s = this.setup.status();
    return s ? serverChecks(s) : [];
  });
  protected readonly runner = computed(
    () => this.setup.status()?.runner ?? { connected: false, checks: null },
  );

  /** Il passo corrente impedisce di andare avanti. */
  protected readonly blocked = computed(() => {
    switch (this.step()) {
      case 'server':
        return this.setup.offline() || blocking(this.server());
      case 'runner':
        return !this.runner().connected;
      case 'env': {
        const checks = this.runner().checks;
        return !checks || blocking(checks);
      }
      default:
        return false;
    }
  });
  protected readonly warned = computed(() => {
    const list =
      this.step() === 'server'
        ? this.server()
        : this.step() === 'env'
          ? (this.runner().checks ?? [])
          : [];
    return list.some((c) => !c.ok && c.severity === 'warn');
  });

  constructor() {
    // Finché il wizard è aperto lo stato si aggiorna da solo (runner che si collega, verifiche).
    const timer = setInterval(() => void this.setup.load(), 2000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  protected stepLabel(s: StepId): I18nKey {
    return `setup.step.${s}`;
  }

  protected go(delta: number): void {
    if (delta > 0 && this.blocked()) return;
    this.index.update((i) => Math.min(STEPS.length - 1, Math.max(0, i + delta)));
  }

  protected async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(RUNNER_CMD);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    } catch {
      /* appunti non disponibili */
    }
  }

  protected async recheck(): Promise<void> {
    this.rechecking.set(true);
    await this.setup.recheck();
    // Le verifiche arrivano in pochi secondi: il polling le raccoglie.
    setTimeout(() => this.rechecking.set(false), 2500);
  }

  protected async finish(): Promise<void> {
    this.finishing.set(true);
    try {
      await this.setup.complete();
    } finally {
      this.finishing.set(false);
    }
  }
}
