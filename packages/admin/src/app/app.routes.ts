import type { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./chat/chat').then((m) => m.Chat),
    children: [
      { path: '', loadComponent: () => import('./chat/composer').then((m) => m.Composer) },
      { path: 'runs/:id', loadComponent: () => import('./chat/thread').then((m) => m.Thread) },
    ],
  },
  { path: 'progetti', loadComponent: () => import('./projects/projects').then((m) => m.Projects) },
  { path: '**', redirectTo: '' },
];
