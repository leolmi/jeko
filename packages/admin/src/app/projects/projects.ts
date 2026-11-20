import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { HttpClient, httpResource } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import type { Project } from '@jeko/shared';

@Component({
  selector: 'jk-projects',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="mb-4 text-2xl font-bold">Progetti</h1>

    <form class="mb-6 flex gap-2" (ngSubmit)="create()">
      <input
        class="flex-1 rounded border border-zinc-300 px-3 py-2"
        name="name"
        placeholder="Nome del progetto"
        aria-label="Nome del progetto"
        [(ngModel)]="name"
      />
      <button class="rounded bg-zinc-900 px-4 py-2 text-white" type="submit">Crea</button>
    </form>

    @if (projects.error()) {
      <p class="text-red-600">Server non raggiungibile.</p>
    }
    <ul class="divide-y divide-zinc-200 rounded border border-zinc-200 bg-white">
      @for (p of projects.value(); track p.id) {
        <li class="flex justify-between px-4 py-2">
          <span>{{ p.name }}</span>
          <span class="font-mono text-xs text-zinc-500">{{ p.createdAt }}</span>
        </li>
      } @empty {
        <li class="px-4 py-2 text-zinc-500">Nessun progetto.</li>
      }
    </ul>
  `,
})
export class Projects {
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
