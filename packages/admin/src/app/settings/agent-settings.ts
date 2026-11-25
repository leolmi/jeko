import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import type { AgentsSettings } from '@jeko/shared';
import { I18n } from '../core/i18n';
import { Settings } from '../core/settings';
import { Setup } from '../core/setup';
import { CheckList } from '../setup/check-list';
import { Icon } from '../ui/icon';
import { Segmented, type SegmentOption } from '../ui/segmented';

/** Attesa massima delle verifiche rifatte dal runner. */
const CHECK_WAIT_MS = 30_000;

/** Agente dei task: quale usare, con che comando, e le sue verifiche. */
@Component({
  selector: 'jk-agent-settings',
  imports: [CheckList, Icon, Segmented],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block rounded-xl border border-line bg-surface p-4' },
  template: `
    <p class="text-sm font-medium">{{ i18n.t('agents.title') }}</p>
    <p class="mt-0.5 text-xs text-faint">{{ i18n.t('agents.hint') }}</p>

    @if (agents().length === 0) {
      <p class="mt-3 text-sm text-muted">{{ i18n.t('agents.offline') }}</p>
    } @else {
      <div class="mt-3 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2.5">
        <span class="jk-label">{{ i18n.t('agents.agent') }}</span>
        <jk-segmented
          [label]="i18n.t('agents.agent')"
          [options]="options()"
          [value]="current().id"
          (valueChange)="choose($event)"
        />

        <span class="jk-label">{{ i18n.t('agents.command') }}</span>
        <input
          class="jk-input w-full font-mono text-sm"
          type="text"
          spellcheck="false"
          [attr.aria-label]="i18n.t('agents.command')"
          [placeholder]="current().command"
          [value]="command()"
          (change)="setCommand($any($event.target).value)"
        />
      </div>
      <p class="mt-2 text-xs text-faint">{{ i18n.t('agents.command.hint') }}</p>

      <div class="mt-4 flex items-center gap-3">
        <p class="flex-1 text-xs text-faint">
          @if (saveError()) {
            <span class="text-red-600 dark:text-red-400">{{ i18n.t('settings.error') }}</span>
          } @else {
            {{ i18n.t('agents.checks', { a: current().label }) }}
          }
        </p>
        <button type="button" class="jk-btn-outline" [disabled]="checking()" (click)="recheck()">
          <jk-icon name="refresh" [size]="16" [class]="checking() ? 'animate-spin' : ''" />
          {{ i18n.t('agents.recheck') }}
        </button>
      </div>
      @if (checks().length) {
        <div class="mt-3"><jk-check-list [checks]="checks()" /></div>
      }
    }
  `,
})
export class AgentSettings {
  protected readonly i18n = inject(I18n);
  private readonly settings = inject(Settings);
  private readonly setup = inject(Setup);
  protected readonly checking = signal(false);
  protected readonly saveError = signal(false);

  protected readonly agents = computed(() => this.setup.status()?.runner.agents ?? []);
  private readonly config = computed((): AgentsSettings => this.settings.value()?.agents ?? {});
  /** Agente scelto; un id sconosciuto al runner ricade sul primo, come nel runner. */
  protected readonly current = computed(() => {
    const list = this.agents();
    return list.find((a) => a.id === this.config().default) ?? list[0]!;
  });
  protected readonly command = computed(() => this.config().commands?.[this.current().id] ?? '');
  protected readonly options = computed((): SegmentOption<string>[] =>
    this.agents().map((a) => ({
      value: a.id,
      label: a.preview ? `${a.label} · ${this.i18n.t('agents.preview')}` : a.label,
    })),
  );
  /** Verifiche dell'agente scelto: `<id>` e `<id>.…`. */
  protected readonly checks = computed(() => {
    const id = this.current()?.id;
    return (this.setup.status()?.runner.checks ?? []).filter(
      (c) => c.id === id || c.id.startsWith(`${id}.`),
    );
  });

  constructor() {
    if (!this.settings.value()) void this.settings.load();
    if (!this.setup.status()) void this.setup.load();
  }

  protected choose(id: string): void {
    void this.save({ ...this.config(), default: id });
  }

  protected setCommand(value: string): void {
    const commands = { ...this.config().commands };
    const cmd = value.trim();
    if (cmd) commands[this.current().id] = cmd;
    else delete commands[this.current().id];
    const next: AgentsSettings = { ...this.config() };
    if (Object.keys(commands).length) next.commands = commands;
    else delete next.commands;
    void this.save(next);
  }

  /** Salva e aspetta le verifiche che il runner rifà quando l'agente cambia. */
  private async save(agents: AgentsSettings): Promise<void> {
    this.saveError.set(false);
    try {
      const current = this.settings.value() ?? (await this.settings.load());
      const before = this.setup.status()?.runner.checkedAt;
      await this.settings.save({ ...current, agents });
      await this.waitChecks(before);
    } catch {
      this.saveError.set(true);
    }
  }

  protected async recheck(): Promise<void> {
    const before = this.setup.status()?.runner.checkedAt;
    await this.setup.recheck();
    await this.waitChecks(before);
  }

  /** Rilegge lo stato finché arrivano verifiche nuove (o fino a {@link CHECK_WAIT_MS}). */
  private async waitChecks(before: string | undefined): Promise<void> {
    this.checking.set(true);
    try {
      for (let waited = 0; waited < CHECK_WAIT_MS; waited += 1000) {
        await new Promise((r) => setTimeout(r, 1000));
        const s = await this.setup.load();
        if (s?.runner.checkedAt && s.runner.checkedAt !== before) return;
      }
    } finally {
      this.checking.set(false);
    }
  }
}
