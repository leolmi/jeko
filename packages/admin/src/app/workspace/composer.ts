import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import type { RunMode } from '@jeko/shared';
import { I18n } from '../core/i18n';
import { Projects } from '../core/projects';
import { Realtime } from '../core/realtime';
import { Runs } from '../core/runs';
import { storage } from '../core/storage';
import { Icon } from '../ui/icon';
import { Segmented, type SegmentOption } from '../ui/segmented';

export const MODES: RunMode[] = ['headless', 'checkpoint', 'interactive'];

/**
 * Chat in fondo alla pagina: un nuovo task sul progetto attivo, nella sua cartella.
 * Il testo non inviato resta al progetto: cambiando progetto si ritrova il suo.
 */
@Component({
  selector: 'jk-task-composer',
  imports: [Icon, Segmented],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex flex-col bg-surface px-6 py-3' },
  template: `
    <div
      class="flex min-h-0 flex-1 flex-col rounded-2xl border border-line bg-bg focus-within:border-faint"
      [class.opacity-60]="!project()"
    >
      <textarea
        class="block min-h-0 w-full flex-1 resize-none bg-transparent px-4 pt-3 text-sm leading-relaxed outline-none"
        [attr.aria-label]="i18n.t('composer.request')"
        [placeholder]="
          project() ? i18n.t('composer.placeholder', { name: project()!.name }) : i18n.t('ws.empty')
        "
        [disabled]="!project()?.path"
        [value]="draft()"
        (input)="setDraft($any($event.target).value)"
        (keydown.control.enter)="submit()"
      ></textarea>
      <div class="flex flex-wrap items-center gap-3 px-3 pt-1 pb-2.5">
        <jk-segmented [label]="i18n.t('composer.mode')" [options]="modes()" [(value)]="mode" />
        <span class="hidden min-w-0 flex-1 truncate text-xs text-faint lg:inline">
          @if (error()) {
            <span class="text-red-600 dark:text-red-400">{{ i18n.t('composer.error') }}</span>
          } @else if (!rt.runner().connected) {
            {{ i18n.t('composer.queued') }}
          } @else if (busy()) {
            {{ i18n.t('composer.busy') }}
          } @else {
            {{ i18n.t('composer.shortcut') }}
          }
        </span>
        <button
          type="button"
          class="jk-btn-primary ml-auto"
          [disabled]="!valid() || sending()"
          (click)="submit()"
        >
          <jk-icon name="send" [size]="16" />
          {{ i18n.t(busy() ? 'composer.enqueue' : 'composer.send') }}
        </button>
      </div>
    </div>
  `,
})
export class TaskComposer {
  protected readonly i18n = inject(I18n);
  protected readonly rt = inject(Realtime);
  private readonly projects = inject(Projects);
  private readonly runs = inject(Runs);
  private readonly router = inject(Router);

  protected readonly project = this.projects.active;
  protected readonly draft = computed(() => {
    const p = this.project();
    return (p && this.projects.drafts()[p.id]) ?? '';
  });
  /** Il progetto ha già un task attivo: il nuovo andrà in coda. */
  protected readonly busy = computed(() => (this.project()?.open.length ?? 0) > 0);
  protected readonly mode = signal<RunMode>(
    MODES.find((m) => m === storage.get('mode')) ?? 'checkpoint',
  );
  protected readonly modes = computed((): SegmentOption<RunMode>[] =>
    MODES.map((m) => ({
      value: m,
      label: this.i18n.t(`composer.mode.${m}`),
      hint: this.i18n.t(`composer.mode.${m}.hint`),
    })),
  );
  protected readonly sending = signal(false);
  protected readonly error = signal(false);
  protected readonly valid = computed(
    () => !!this.project()?.path && this.draft().trim().length > 0,
  );

  constructor() {
    effect(() => storage.set('mode', this.mode()));
  }

  protected setDraft(text: string): void {
    const p = this.project();
    if (p) this.projects.setDraft(p.id, text);
  }

  protected submit(): void {
    const p = this.project();
    if (!p || !this.valid() || this.sending()) return;
    this.sending.set(true);
    this.error.set(false);
    this.runs
      .start({
        request: this.draft().trim(),
        mode: this.mode(),
        cwd: p.path,
      })
      .subscribe({
        next: (run) => {
          this.sending.set(false);
          this.projects.setDraft(p.id, '');
          void this.router.navigate(['/runs', run.id]);
        },
        error: () => {
          this.sending.set(false);
          this.error.set(true);
        },
      });
  }
}
