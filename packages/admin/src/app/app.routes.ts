import type { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./workspace/workspace').then((m) => m.Workspace),
    children: [
      { path: '', loadComponent: () => import('./workspace/tasks').then((m) => m.Tasks) },
      { path: 'runs/:id', loadComponent: () => import('./chat/thread').then((m) => m.Thread) },
      {
        path: 'progetti/:id',
        loadComponent: () => import('./workspace/project-settings').then((m) => m.ProjectSettings),
      },
      {
        path: 'nuovo',
        loadComponent: () => import('./workspace/new-project').then((m) => m.NewProject),
      },
    ],
  },
  {
    path: 'workflow',
    loadComponent: () => import('./workflows/workflows-page').then((m) => m.WorkflowsPage),
  },
  {
    path: 'statistiche',
    loadComponent: () => import('./stats/stats-page').then((m) => m.StatsPage),
  },
  {
    path: 'note',
    loadComponent: () => import('./notes/notes-page').then((m) => m.NotesPage),
  },
  {
    path: 'opzioni',
    loadComponent: () => import('./settings/settings-page').then((m) => m.SettingsPage),
  },
  { path: '**', redirectTo: '' },
];
