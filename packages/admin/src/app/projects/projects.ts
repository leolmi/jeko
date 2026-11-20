import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { HttpClient, httpResource } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import type { Project } from '@jeko/shared';
import { I18n } from '../core/i18n';
import { Icon } from '../ui/icon';

@Component({
  selector: 'jk-projects',
  imports: [FormsModule, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block h-full overflow-y-auto' },
  template: `
    <div class="mx-auto max-w-3xl px-6 py-10">
      <h1 class="text-2xl font-bold tracking-tight">{{ i18n.t('projects.title') }}</h1>

      <form class="mt-6 flex gap-2" (ngSubmit)="create()">
        <input
          class="jk-input"
          name="name"
          autocomplete="off"
          [placeholder]="i18n.t('projects.name')"
          [attr.aria-label]="i18n.t('projects.name')"
          [(ngModel)]="name"
        />
        <button class="jk-btn-primary" type="submit" [disabled]="!name().trim()">
          <jk-icon name="add" [size]="16" />
          {{ i18n.t('projects.create') }}
        </button>
      </form>

      @if (projects.error()) {
        <p class="mt-4 text-sm text-red-600 dark:text-red-400">{{ i18n.t('server.off') }}</p>
      }
      <ul
        class="mt-6 divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface"
      >
        @for (p of projects.value(); track p.id) {
          <li class="flex items-center gap-3 px-4 py-3">
            <jk-icon name="folder" [size]="18" class="text-faint" />
            <span class="flex-1 text-sm">{{ p.name }}</span>
            <span class="text-xs text-faint">{{ i18n.ago(p.createdAt) }}</span>
          </li>
        } @empty {
          <li class="px-4 py-6 text-center text-sm text-faint">{{ i18n.t('projects.empty') }}</li>
        }
      </ul>
    </div>
  `,
})
export class Projects {
  protected readonly i18n = inject(I18n);
  private readonly http = inject(HttpClient);
  protected readonly name = signal('');
  protected readonly projects = httpResource<Project[]>(() => '/api/projects', {
    defaultValue: [],
  });

  protected create(): void {
    const name = this.name().trim();
    if (!name) return;
    this.http.post<Project>('/api/projects', { name }).subscribe(() => {
      this.name.set('');
      this.projects.reload();
    });
  }
}
