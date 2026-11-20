import { HttpClient } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import type { ProjectTemplate } from '@jeko/shared';
import { firstValueFrom } from 'rxjs';

/** Template per creare progetti con l'AI: prompt già pronti, con un nome. */
@Injectable({ providedIn: 'root' })
export class Templates {
  private readonly http = inject(HttpClient);
  readonly list = signal<ProjectTemplate[]>([]);

  constructor() {
    this.reload();
  }

  reload(): void {
    this.http.get<ProjectTemplate[]>('/api/templates').subscribe({
      next: (ts) => this.list.set(ts),
      error: () => undefined,
    });
  }

  /** Crea o sostituisce; un prompt non valido torna come errore 422 con `issues`. */
  async save(name: string, prompt: string): Promise<ProjectTemplate> {
    const t = await firstValueFrom(
      this.http.put<ProjectTemplate>(`/api/templates/${encodeURIComponent(name)}`, { prompt }),
    );
    this.list.update((ts) =>
      [...ts.filter((x) => x.name !== t.name), t].sort((a, b) =>
        a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
      ),
    );
    return t;
  }

  async remove(name: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/api/templates/${encodeURIComponent(name)}`));
    this.list.update((ts) => ts.filter((x) => x.name !== name));
  }
}
