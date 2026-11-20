import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { Projects } from '../core/projects';
import { Runs } from '../core/runs';
import { TaskComposer } from './composer';
import { Sidebar } from './sidebar';

/**
 * Pagina principale: i progetti a sinistra; a destra, sopra, i task del progetto attivo
 * (o il filo di uno di essi) e, sotto, la chat per un nuovo task su quel progetto.
 */
@Component({
  selector: 'jk-workspace',
  imports: [RouterOutlet, Sidebar, TaskComposer],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'flex h-full' },
  template: `
    <jk-sidebar class="w-[30%] min-w-60 max-w-md shrink-0 border-r border-line" />
    <div class="flex min-w-0 flex-1 flex-col">
      <section class="min-h-0 flex-1">
        <router-outlet />
      </section>
      <jk-task-composer class="h-[30%] min-h-44 shrink-0 border-t border-line" />
    </div>
  `,
})
export class Workspace {
  constructor() {
    const projects = inject(Projects);
    const runs = inject(Runs);
    const url = toSignal(
      inject(Router).events.pipe(
        filter((e) => e instanceof NavigationEnd),
        map((e) => e.urlAfterRedirects),
      ),
      { initialValue: inject(Router).url },
    );
    // Aprendo il filo di un task, il suo progetto diventa quello attivo.
    effect(() => {
      const id = /^\/runs\/([^/?#]+)/.exec(url())?.[1];
      const project = id && projects.of(runs.list().find((r) => r.id === id));
      if (project) projects.activeId.set(project.id);
    });
  }
}
