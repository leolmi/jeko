import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
} from '@angular/core';
import {
  ESSENTIAL_TOOLS,
  type ContextExclusions,
  type ContextInventory,
  type Project,
} from '@jeko/shared';
import { firstValueFrom } from 'rxjs';
import { I18n } from '../core/i18n';
import { Projects } from '../core/projects';
import { Icon } from '../ui/icon';

type ListKey = 'tools' | 'mcpServers' | 'plugins';

interface Chip {
  /** Valore salvato nell'esclusione (nome dello strumento o del server, sorgente del plugin). */
  value: string;
  label: string;
  detail?: string;
  locked?: boolean;
}

const EMPTY: ContextExclusions = { tools: [], mcpServers: [], plugins: [], skills: false };
const essential = new Set<string>(ESSENTIAL_TOOLS);

/**
 * Esclusioni dal contesto di claude per le run del progetto: l'elenco di cosa carica lo
 * legge il runner avviando claude nella cartella; si spunta cosa togliere e si salva.
 */
@Component({
  selector: 'jk-project-context',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex items-start gap-3">
      <div class="min-w-0 flex-1">
        <p class="text-sm font-medium">
          {{ i18n.t('context.title') }}
          @if (count() > 0) {
            <span class="ml-1.5 rounded-full bg-subtle px-2 py-0.5 text-xs text-muted">{{
              i18n.t('context.count', { n: count() })
            }}</span>
          }
        </p>
        <p class="mt-0.5 text-xs text-faint">{{ i18n.t('context.hint') }}</p>
      </div>
      <button
        type="button"
        class="jk-btn-outline shrink-0"
        [disabled]="reading()"
        [title]="i18n.t('context.read.hint')"
        (click)="read()"
      >
        <jk-icon name="refresh" [size]="16" [class.animate-spin]="reading()" />
        {{ i18n.t(reading() ? 'context.reading' : 'context.read') }}
      </button>
    </div>

    @if (readError(); as e) {
      <p class="mt-2 text-xs text-red-600 dark:text-red-400">
        {{ i18n.t('context.error', { message: e }) }}
      </p>
    }
    @if (!inventory() && count() === 0) {
      <p class="mt-3 text-xs text-faint">{{ i18n.t('context.empty') }}</p>
    } @else {
      @for (g of groups(); track g.key) {
        <div class="mt-4">
          <p class="jk-label">{{ i18n.t(g.title) }}</p>
          <div class="mt-1.5 flex flex-wrap gap-1.5">
            @for (c of g.chips; track c.value) {
              @let off = excluded(g.key, c.value);
              <button
                type="button"
                class="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-xs transition-colors"
                [class]="
                  c.locked
                    ? 'cursor-not-allowed border-line text-faint'
                    : off
                      ? 'border-red-300 bg-red-500/10 text-red-700 line-through dark:border-red-900 dark:text-red-400'
                      : 'border-line text-fg hover:bg-subtle'
                "
                [disabled]="c.locked"
                [attr.aria-pressed]="off"
                [title]="
                  (c.detail ? c.detail + ' · ' : '') +
                  i18n.t(
                    c.locked ? 'context.essential' : off ? 'context.excluded' : 'context.included'
                  )
                "
                (click)="toggle(g.key, c.value)"
              >
                @if (off) {
                  <jk-icon name="block" [size]="12" />
                }
                {{ c.label }}
              </button>
            } @empty {
              <span class="text-xs text-faint">{{ i18n.t('context.none') }}</span>
            }
          </div>
        </div>
      }
      <div class="mt-4">
        <p class="jk-label">{{ i18n.t('context.skills') }}</p>
        <label class="mt-1.5 flex cursor-pointer items-center gap-2 text-sm select-none">
          <input
            type="checkbox"
            class="size-4 accent-accent"
            [checked]="draft().skills"
            (change)="setSkills($any($event.target).checked)"
          />
          {{ i18n.t('context.skills.off', { n: skills().length }) }}
        </label>
        @if (skills().length) {
          <p
            class="mt-1 line-clamp-2 font-mono text-xs text-faint"
            [class.line-through]="draft().skills"
            [title]="skills().join(', ')"
          >
            {{ skills().join(' · ') }}
          </p>
        }
        <p class="mt-1 text-xs text-faint">{{ i18n.t('context.skills.note') }}</p>
      </div>
    }

    <div class="mt-4 flex items-center justify-end gap-3">
      @if (dirty() && project().open.length) {
        <span class="mr-auto text-xs text-amber-700 dark:text-amber-400">{{
          i18n.t('context.open')
        }}</span>
      }
      @if (saveError()) {
        <span class="text-sm text-red-600 dark:text-red-400">{{
          i18n.t('project.save.error')
        }}</span>
      } @else if (saved()) {
        <span class="text-sm text-faint">{{ i18n.t('project.saved') }}</span>
      }
      <button
        type="button"
        class="jk-btn-primary"
        [disabled]="!dirty() || saving()"
        (click)="save()"
      >
        <jk-icon name="save" [size]="16" /> {{ i18n.t('project.save') }}
      </button>
    </div>
  `,
})
export class ProjectContext {
  protected readonly i18n = inject(I18n);
  private readonly http = inject(HttpClient);
  private readonly projects = inject(Projects);
  readonly project = input.required<Project & { open: readonly unknown[] }>();

  protected readonly inventory = signal<ContextInventory | null>(null);
  protected readonly reading = signal(false);
  protected readonly readError = signal<string | null>(null);

  private readonly stored = computed(() => this.project().exclude ?? EMPTY);
  protected readonly draft = linkedSignal(() => this.stored());
  protected readonly dirty = computed(
    () => JSON.stringify(normalize(this.draft())) !== JSON.stringify(normalize(this.stored())),
  );
  protected readonly count = computed(() => {
    const d = this.draft();
    return d.tools.length + d.mcpServers.length + d.plugins.length + (d.skills ? 1 : 0);
  });
  protected readonly saving = signal(false);
  protected readonly saved = signal(false);
  protected readonly saveError = signal(false);

  protected readonly skills = computed(() => this.inventory()?.skills ?? []);

  /** Cosa c'è (dall'ultima lettura) più cosa è già escluso, anche se ora non si vede. */
  protected readonly groups = computed(() => {
    const inv = this.inventory();
    const d = this.stored();
    const merge = (chips: Chip[], saved: string[]): Chip[] => [
      ...chips,
      ...saved
        .filter((v) => !chips.some((c) => c.value === v))
        .map((v) => ({ value: v, label: v })),
    ];
    return [
      {
        key: 'mcpServers' as const,
        title: 'context.mcp' as const,
        chips: merge(
          (inv?.mcpServers ?? []).map((m) => ({ value: m.name, label: m.name, detail: m.status })),
          d.mcpServers,
        ),
      },
      {
        key: 'plugins' as const,
        title: 'context.plugins' as const,
        chips: merge(
          (inv?.plugins ?? []).map((p) => ({ value: p.source, label: p.name, detail: p.source })),
          d.plugins,
        ),
      },
      {
        key: 'tools' as const,
        title: 'context.tools' as const,
        chips: merge(
          (inv?.tools ?? []).map((t) => ({ value: t, label: t, locked: essential.has(t) })),
          d.tools,
        ),
      },
    ];
  });

  protected excluded(key: ListKey, value: string): boolean {
    return this.draft()[key].includes(value);
  }

  protected toggle(key: ListKey, value: string): void {
    this.saved.set(false);
    this.draft.update((d) => ({
      ...d,
      [key]: d[key].includes(value) ? d[key].filter((v) => v !== value) : [...d[key], value],
    }));
  }

  protected setSkills(skills: boolean): void {
    this.saved.set(false);
    this.draft.update((d) => ({ ...d, skills }));
  }

  protected async read(): Promise<void> {
    this.reading.set(true);
    this.readError.set(null);
    try {
      this.inventory.set(
        await firstValueFrom(
          this.http.get<ContextInventory>(`/api/projects/${this.project().id}/context`),
        ),
      );
    } catch (e) {
      const msg = e instanceof HttpErrorResponse ? (e.error?.message ?? e.message) : String(e);
      this.readError.set(String(msg));
    } finally {
      this.reading.set(false);
    }
  }

  protected save(): void {
    if (this.saving()) return;
    this.saving.set(true);
    this.saved.set(false);
    this.saveError.set(false);
    this.projects
      .setExclusions(this.project().id, normalize(this.draft()))
      .then(() => this.saved.set(true))
      .catch(() => this.saveError.set(true))
      .finally(() => this.saving.set(false));
  }
}

const normalize = (e: ContextExclusions): ContextExclusions => ({
  tools: [...e.tools].sort(),
  mcpServers: [...e.mcpServers].sort(),
  plugins: [...e.plugins].sort(),
  skills: e.skills,
});
