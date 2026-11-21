import { httpResource } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { AgentChoice, WorkflowCheck, WorkflowRecord } from '@jeko/shared';
import { I18n } from '../core/i18n';
import { Projects } from '../core/projects';
import { AgentChoiceSelect } from '../ui/agent-choice';
import { Icon } from '../ui/icon';
import { WorkflowPreview } from '../workflows/preview';
import { ProjectContext } from './project-context';
import { ProjectPrompts } from './project-prompts';

/**
 * Opzioni del progetto: il workflow di sviluppo che i suoi task seguono, fissato qui
 * e non a ogni task. Vale sempre l'ultima versione del workflow scelto.
 */
@Component({
  selector: 'jk-project-settings',
  imports: [
    FormsModule,
    RouterLink,
    Icon,
    WorkflowPreview,
    ProjectPrompts,
    ProjectContext,
    AgentChoiceSelect,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full overflow-y-auto' },
  template: `
    @if (project(); as p) {
      <div class="mx-auto max-w-3xl px-6 py-5">
        <a class="inline-flex items-center gap-1 text-xs text-faint hover:text-fg" routerLink="/">
          <jk-icon name="arrow_back" [size]="14" /> {{ i18n.t('tasks.back') }}
        </a>
        <h2 class="mt-2 text-xl font-semibold tracking-tight">
          {{ i18n.t('project.settings.title', { name: p.name }) }}
        </h2>
        <p class="mt-0.5 font-mono text-xs text-faint">{{ p.path }}</p>

        <section class="mt-5 rounded-xl border border-line bg-surface p-4">
          <p class="text-sm font-medium">{{ i18n.t('project.workflow') }}</p>
          <p class="mt-0.5 text-xs text-faint">{{ i18n.t('project.workflow.hint') }}</p>
          <div class="mt-3 flex flex-wrap items-center gap-3">
            <select
              class="jk-input w-auto text-sm"
              name="workflow"
              [attr.aria-label]="i18n.t('project.workflow')"
              [(ngModel)]="choice"
            >
              <option value="">
                {{ i18n.t('tasks.workflow.default', { name: develop()[0]?.name ?? '—' }) }}
              </option>
              @for (w of develop(); track w.name) {
                <option [value]="w.name">{{ w.name }} · v{{ w.version }}</option>
              }
              @if (p.workflow && !known(p.workflow)) {
                <option [value]="p.workflow">
                  {{ i18n.t('tasks.workflow.missing', { name: p.workflow }) }}
                </option>
              }
            </select>
            @if (error()) {
              <span class="text-sm text-red-600 dark:text-red-400">{{
                i18n.t('project.save.error')
              }}</span>
            } @else if (saved()) {
              <span class="text-sm text-faint">{{ i18n.t('project.saved') }}</span>
            }
            <button
              type="button"
              class="jk-btn-primary ml-auto"
              [disabled]="!dirty() || saving()"
              (click)="save(p.id)"
            >
              <jk-icon name="save" [size]="16" /> {{ i18n.t('project.save') }}
            </button>
          </div>
          @if (dirty() && p.open.length) {
            <p class="mt-2 text-xs text-amber-700 dark:text-amber-400">
              {{ i18n.t('project.workflow.open', { n: p.open.length }) }}
            </p>
          }
        </section>

        <section class="mt-4 rounded-xl border border-line bg-surface p-4">
          <p class="text-sm font-medium">{{ i18n.t('agent.title') }}</p>
          <p class="mt-0.5 text-xs text-faint">{{ i18n.t('agent.hint') }}</p>
          <div class="mt-3 flex flex-wrap items-center gap-3">
            <jk-agent-choice [(value)]="agent" [defaultModel]="projects.defaultModel(p.path)" />
            @if (agentError()) {
              <span class="text-sm text-red-600 dark:text-red-400">{{
                i18n.t('project.save.error')
              }}</span>
            } @else if (agentSaved()) {
              <span class="text-sm text-faint">{{ i18n.t('project.saved') }}</span>
            }
            <button
              type="button"
              class="jk-btn-primary ml-auto"
              [disabled]="!agentDirty() || agentSaving()"
              (click)="saveAgent(p.id)"
            >
              <jk-icon name="save" [size]="16" /> {{ i18n.t('project.save') }}
            </button>
          </div>
        </section>

        @if (preview(); as wf) {
          <section class="mt-4 rounded-xl border border-line bg-surface p-4">
            <jk-workflow-preview [workflow]="wf" />
          </section>
        }

        @if (p.path) {
          <section class="mt-4 rounded-xl border border-line bg-surface p-4">
            <jk-project-prompts [projectId]="p.id" [used]="usedPrompts()" />
          </section>
          <section class="mt-4 rounded-xl border border-line bg-surface p-4">
            <jk-project-context [project]="p" />
          </section>
        }
      </div>
    } @else if (projects.loaded()) {
      <p class="flex h-full items-center justify-center text-sm text-faint">
        {{ i18n.t('tasks.none') }}
      </p>
    }
  `,
})
export class ProjectSettings {
  protected readonly i18n = inject(I18n);
  protected readonly projects = inject(Projects);
  /** Dalla rotta `progetti/:id`. */
  readonly id = input.required<string>();

  protected readonly project = computed(() =>
    this.projects.views().find((p) => p.id === this.id()),
  );
  private readonly workflows = httpResource<WorkflowRecord[]>(() => '/api/workflows');
  protected readonly develop = computed(() =>
    (this.workflows.hasValue() ? this.workflows.value() : []).filter((w) => w.kind === 'develop'),
  );

  /** Scelta nel form; '' = il predefinito. */
  protected readonly choice = linkedSignal(() => this.project()?.workflow ?? '');
  protected readonly dirty = computed(() => this.choice() !== (this.project()?.workflow ?? ''));
  protected readonly saving = signal(false);
  protected readonly saved = signal(false);
  protected readonly error = signal(false);

  /** Il workflow che i task seguiranno, disegnato. */
  private readonly effective = computed(() => {
    const name = this.choice() || this.develop()[0]?.name;
    return this.develop().find((w) => w.name === name);
  });
  private readonly check = httpResource<WorkflowCheck>(() => {
    const wf = this.effective();
    return wf
      ? { url: '/api/workflows/check', method: 'POST', body: { yaml: wf.yaml } }
      : undefined;
  });
  protected readonly preview = computed(() => {
    const c = this.check.hasValue() ? this.check.value() : undefined;
    return c?.ok ? c.workflow : undefined;
  });

  /** Prompt del progetto chiamati dal workflow scelto (passi `prompt: <nome>`). */
  protected readonly usedPrompts = computed(() =>
    (this.preview()?.steps ?? []).flatMap((s) =>
      s.type === 'agent' && s.prompt !== undefined ? [s.prompt] : [],
    ),
  );

  /** Ragionamento e modello nel form. */
  protected readonly agent = linkedSignal<AgentChoice>(() => this.project()?.agent ?? {});
  protected readonly agentDirty = computed(() => {
    const a = this.agent();
    const p = this.project()?.agent ?? {};
    return a.effort !== p.effort || a.model !== p.model;
  });
  protected readonly agentSaving = signal(false);
  protected readonly agentSaved = signal(false);
  protected readonly agentError = signal(false);

  protected saveAgent(id: string): void {
    if (this.agentSaving()) return;
    this.agentSaving.set(true);
    this.agentSaved.set(false);
    this.agentError.set(false);
    this.projects
      .setAgent(id, this.agent())
      .then(() => this.agentSaved.set(true))
      .catch(() => this.agentError.set(true))
      .finally(() => this.agentSaving.set(false));
  }

  protected known(name: string): boolean {
    return this.develop().some((w) => w.name === name);
  }

  protected save(id: string): void {
    if (this.saving()) return;
    this.saving.set(true);
    this.saved.set(false);
    this.error.set(false);
    this.projects
      .setWorkflow(id, this.choice() || null)
      .then(() => this.saved.set(true))
      .catch(() => this.error.set(true))
      .finally(() => this.saving.set(false));
  }
}
