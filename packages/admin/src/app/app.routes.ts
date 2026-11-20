import type { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./projects/projects').then((m) => m.Projects) },
  { path: '**', redirectTo: '' },
];
