import { httpResource } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import type { RunMode, WorkflowKind, WorkflowRecord } from '@jeko/shared';
import { I18n } from '../core/i18n';
import { Realtime } from '../core/realtime';
import { Runs } from '../core/runs';
import { storage } from '../core/storage';
import { Icon } from '../ui/icon';
import { Segmented, type SegmentOption } from '../ui/segmented';

const MODES: RunMode[] = ['headless', 'checkpoint', 'interactive'];

/** Nuova richiesta: testo libero, tipo di workflow, cartella e livello di controllo. */
@Component({
  selector: 'jk-composer',
  imports: [FormsModule, Icon, Segmented],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex h-full overflow-y-auto' },
  template: `
    <form class="m-auto w-full max-w-2xl px-6 py-12" (ngSubmit)="submit()">
      <h1 class="text-2xl font-bold tracking-tight">{{ i18n.t('composer.title') }}</h1>
      <p class="mt-1 text-sm text-muted">{{ i18n.t('composer.subtitle') }}</p>

      <div class="mt-8 flex flex-wrap items-center gap-3">
        <jk-segmented [label]="i18n.t('composer.kind')" [options]="kinds()" [(value)]="kind" />
        @if (ofKind().length > 1) {
          <select
            class="jk-input w-auto py-1.5"
            name="workflow"
            [attr.aria-label]="i18n.t('composer.workflow')"
            [(ngModel)]="workflow"
          >
            @for (w of ofKind(); track w.name) {
              <option [value]="w.name">{{ w.name }}</option>
            }
          </select>
        }
      </div>
      @if (selected(); as w) {
        <p class="mt-2 text-xs text-faint">
          <span class="font-mono">{{ w.name }}@{{ w.version }}</span>
          @if (w.description) {
            · {{ w.description }}
          }
        </p>
      } @else if (workflows.hasValue()) {
        <p class="mt-2 text-xs text-amber-600 dark:text-amber-400">
          {{ i18n.t('composer.noWorkflow') }}
        </p>
      }

      <div
        class="mt-6 rounded-2xl border border-line bg-surface shadow-sm focus-within:border-faint"
      >
        <textarea
          class="block w-full resize-none rounded-t-2xl bg-transparent px-4 pt-4 text-sm leading-relaxed outline-none"
          rows="5"
          name="request"
          [attr.aria-label]="i18n.t('composer.request')"
          [placeholder]="
            i18n.t(kind() === 'create' ? 'composer.request.create' : 'composer.request.develop')
          "
          [(ngModel)]="request"
          (keydown.control.enter)="submit()"
        ></textarea>
        <div class="flex items-center gap-3 px-3 pt-1 pb-3">
          <span class="hidden text-xs text-faint sm:inline">{{ i18n.t('composer.shortcut') }}</span>
          <button type="submit" class="jk-btn-primary ml-auto" [disabled]="!valid() || busy()">
            <jk-icon name="send" [size]="16" />
            {{ i18n.t('composer.send') }}
          </button>
        </div>
      </div>

      <div class="mt-6 grid gap-5 sm:grid-cols-2">
        @if (kind() === 'develop') {
          <label class="block sm:col-span-2">
            <span class="jk-label">{{ i18n.t('composer.cwd') }}</span>
            <div class="relative mt-1.5">
              <jk-icon name="folder" [size]="16" class="absolute top-2.5 left-3 text-faint" />
              <input
                class="jk-input pl-9 font-mono"
                name="cwd"
                autocomplete="off"
                spellcheck="false"
                placeholder="C:\\Leo\\sviluppo\\…"
                [(ngModel)]="cwd"
              />
            </div>
          </label>
        }
        <div class="sm:col-span-2">
          <span class="jk-label">{{ i18n.t('composer.mode') }}</span>
          <div class="mt-1.5">
            <jk-segmented [label]="i18n.t('composer.mode')" [options]="modes()" [(value)]="mode" />
          </div>
          <p class="mt-1.5 text-xs text-faint">{{ modeHint() }}</p>
        </div>
      </div>

      @if (!rt.runner().connected) {
        <p class="mt-6 text-xs text-muted">{{ i18n.t('composer.queued') }}</p>
      }
      @if (error()) {
        <p class="mt-4 text-sm text-red-600 dark:text-red-400">{{ i18n.t('composer.error') }}</p>
      }
    </form>
  `,
})
export class Composer {
  protected readonly i18n = inject(I18n);
  protected readonly rt = inject(Realtime);
  private readonly runs = inject(Runs);
  private readonly router = inject(Router);

  protected readonly workflows = httpResource<WorkflowRecord[]>(() => '/api/workflows');

  protected readonly kind = signal<WorkflowKind>(
    storage.get('kind') === 'develop' ? 'develop' : 'create',
  );
  protected readonly mode = signal<RunMode>(
    MODES.find((m) => m === storage.get('mode')) ?? 'checkpoint',
  );
  protected readonly request = signal('');
  protected readonly cwd = signal(storage.get('cwd') ?? '');
  protected readonly busy = signal(false);
  protected readonly error = signal(false);

  protected readonly ofKind = computed(() =>
    (this.workflows.hasValue() ? this.workflows.value() : []).filter((w) => w.kind === this.kind()),
  );
  protected readonly workflow = linkedSignal(() => this.ofKind()[0]?.name ?? '');
  protected readonly selected = computed(() =>
    this.ofKind().find((w) => w.name === this.workflow()),
  );
  protected readonly valid = computed(
    () =>
      !!this.selected() &&
      this.request().trim().length > 0 &&
      (this.kind() === 'create' || this.cwd().trim().length > 0),
  );

  protected readonly kinds = computed((): SegmentOption<WorkflowKind>[] => [
    { value: 'create', label: this.i18n.t('composer.kind.create'), icon: 'create_new_folder' },
    { value: 'develop', label: this.i18n.t('composer.kind.develop'), icon: 'code' },
  ]);
  protected readonly modes = computed((): SegmentOption<RunMode>[] =>
    MODES.map((m) => ({ value: m, label: this.i18n.t(`composer.mode.${m}`) })),
  );
  protected readonly modeHint = computed(() => this.i18n.t(`composer.mode.${this.mode()}.hint`));

  constructor() {
    effect(() => {
      storage.set('kind', this.kind());
      storage.set('mode', this.mode());
    });
  }

  protected submit(): void {
    if (!this.valid() || this.busy()) return;
    const cwd = this.cwd().trim();
    this.busy.set(true);
    this.error.set(false);
    this.runs
      .start({
        workflow: this.workflow(),
        request: this.request().trim(),
        mode: this.mode(),
        ...(this.kind() === 'develop' && { cwd }),
      })
      .subscribe({
        next: (run) => {
          if (cwd) storage.set('cwd', cwd);
          void this.router.navigate(['/runs', run.id]);
        },
        error: () => {
          this.busy.set(false);
          this.error.set(true);
        },
      });
  }
}
