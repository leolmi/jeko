import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import type { Step, StepType, Workflow } from '@jeko/shared';
import { I18n, type I18nKey } from '../core/i18n';
import { Icon, type IconName } from '../ui/icon';

const LOOK: Record<StepType, { icon: IconName; color: string }> = {
  agent: { icon: 'code', color: 'text-sky-600 dark:text-sky-400 bg-sky-500/10' },
  check: {
    icon: 'check_circle',
    color: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10',
  },
  gate: { icon: 'shield', color: 'text-amber-600 dark:text-amber-400 bg-amber-500/10' },
  ask: { icon: 'help', color: 'text-violet-600 dark:text-violet-400 bg-violet-500/10' },
};

/** Dettaglio breve di un passo: istruzioni, comandi, domanda o messaggio. */
function detail(s: Step): string {
  switch (s.type) {
    case 'agent':
      return s.instructions.trim();
    case 'ask':
      return `${s.question.trim()} → ${s.into}`;
    case 'gate':
      return s.message.trim();
    case 'check':
      return [
        ...(s.commands ?? []).map((c) => `▸ ${c}`),
        ...(s.exec ?? []).map((argv) => `$ ${argv.join(' ')}`),
        ...(s.expect ? [`✓ ${s.expect}`] : []),
      ].join('\n');
  }
}

/** Il workflow disegnato: input, policy e la sequenza dei passi con salti e condizioni. */
@Component({
  selector: 'jk-workflow-preview',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    @let wf = workflow();
    <div class="flex items-baseline gap-2">
      <h3 class="font-mono text-sm font-semibold">{{ wf.name }}</h3>
      <span class="rounded bg-subtle px-1.5 text-xs text-muted">{{
        i18n.t(kindLabel(wf.kind))
      }}</span>
    </div>
    @if (wf.description) {
      <p class="mt-1 text-xs text-muted">{{ wf.description }}</p>
    }

    @if (inputs().length) {
      <p class="jk-label mt-4">{{ i18n.t('wf.inputs') }}</p>
      <ul class="mt-1 space-y-0.5 text-xs">
        @for (i of inputs(); track i.name) {
          <li>
            <span class="font-mono text-fg">{{ i.name }}</span>
            @if (i.required) {
              <span class="text-red-500">*</span>
            }
            <span class="text-muted"> · {{ i.prompt }}</span>
            @if (i.when) {
              <span class="font-mono text-faint"> · {{ i18n.t('wf.when') }} {{ i.when }}</span>
            }
          </li>
        }
      </ul>
    }

    @if (wf.policies?.length) {
      <p class="jk-label mt-4">{{ i18n.t('wf.policies') }}</p>
      <div class="mt-1 flex flex-wrap gap-1.5">
        @for (p of wf.policies; track $index) {
          <span
            class="inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-1.5 py-0.5 font-mono text-xs text-amber-700 dark:text-amber-400"
          >
            <jk-icon name="shield" [size]="12" />
            {{ matchOf(p.match) }} · {{ i18n.t(gateLabel(p.gate)) }}
          </span>
        }
      </div>
    }

    <p class="jk-label mt-4">{{ i18n.t('wf.steps') }}</p>
    <ol class="mt-1.5">
      @for (s of wf.steps; track s.id; let i = $index, last = $last) {
        <li class="flex gap-3">
          <div class="flex flex-col items-center">
            <span
              class="flex size-7 shrink-0 items-center justify-center rounded-full"
              [class]="look(s.type).color"
              [title]="s.type"
            >
              <jk-icon [name]="look(s.type).icon" [size]="15" />
            </span>
            @if (!last) {
              <span class="w-px flex-1 bg-line"></span>
            }
          </div>
          <div class="min-w-0 flex-1 pb-4">
            <p class="flex items-baseline gap-2 text-sm">
              <span class="font-medium">{{ s.title ?? s.id }}</span>
              <span class="font-mono text-xs text-faint">{{ s.type }} · {{ s.id }}</span>
            </p>
            @if (s.when) {
              <p class="font-mono text-xs text-violet-600 dark:text-violet-400">
                {{ i18n.t('wf.when') }} {{ s.when }}
              </p>
            }
            @if (detailOf(s); as d) {
              <p
                class="mt-0.5 line-clamp-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-muted"
              >
                {{ d }}
              </p>
            }
            @if (s.type === 'gate' && s.level === 'interactive') {
              <p class="text-xs text-faint">{{ i18n.t('wf.gate.interactive') }}</p>
            }
            @if (s.type === 'check' && s.onFail && s.onFail !== 'stop') {
              <p class="text-xs text-amber-700 dark:text-amber-400">
                ↩ {{ i18n.t('wf.onFail', { step: s.onFail.goto, n: s.onFail.retries }) }}
              </p>
            } @else if (s.type === 'check' && s.onFail === 'stop') {
              <p class="text-xs text-red-600 dark:text-red-400">{{ i18n.t('wf.onFail.stop') }}</p>
            }
          </div>
        </li>
      }
    </ol>
  `,
})
export class WorkflowPreview {
  protected readonly i18n = inject(I18n);
  readonly workflow = input.required<Workflow>();
  protected readonly inputs = computed(() =>
    Object.entries(this.workflow().inputs ?? {}).map(([name, i]) => ({ name, ...i })),
  );

  protected look(type: StepType) {
    return LOOK[type];
  }
  protected detailOf(s: Step): string {
    return detail(s);
  }
  protected matchOf(m: string | string[]): string {
    return Array.isArray(m) ? m.join(', ') : m;
  }
  protected kindLabel(kind: Workflow['kind']): I18nKey {
    return `composer.kind.${kind}`;
  }
  protected gateLabel(level: 'always' | 'interactive'): I18nKey {
    return `wf.gate.${level}`;
  }
}
