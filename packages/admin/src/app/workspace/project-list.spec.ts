import type { ProjectView } from '../core/projects';
import { favoritesOf, moveId, othersOf } from './project-list';

const view = (name: string, last: string, favorite?: number): ProjectView => ({
  id: name,
  name,
  path: `C:\\dev\\${name}`,
  workflow: null,
  createdAt: last,
  ...(favorite !== undefined && { favorite }),
  open: [],
  closed: [],
  waiting: 0,
  last,
});

describe('elenco dei progetti', () => {
  const views = [
    view('alfa', '2026-01-03'),
    view('beta', '2026-01-01', 1),
    view('gamma', '2026-01-02', 0),
    view('delta', '2026-01-04'),
  ];

  it('i preferiti seguono il loro ordine', () => {
    expect(favoritesOf(views).map((p) => p.name)).toEqual(['gamma', 'beta']);
  });

  it('gli altri non ripetono i preferiti', () => {
    expect(othersOf(views, '', 'activity').map((p) => p.name)).toEqual(['delta', 'alfa']);
    expect(othersOf(views, '', 'name').map((p) => p.name)).toEqual(['alfa', 'delta']);
  });

  it('la ricerca non tocca i preferiti', () => {
    expect(othersOf(views, 'GAMMA', 'activity')).toEqual([]);
    expect(othersOf(views, 'al', 'activity').map((p) => p.name)).toEqual(['alfa']);
    expect(favoritesOf(views)).toHaveLength(2);
  });

  it('il trascinamento sposta prima o dopo il bersaglio', () => {
    expect(moveId(['a', 'b', 'c'], 'c', 'a', false)).toEqual(['c', 'a', 'b']);
    expect(moveId(['a', 'b', 'c'], 'a', 'c', true)).toEqual(['b', 'c', 'a']);
    expect(moveId(['a', 'b', 'c'], 'a', 'b', false)).toEqual(['a', 'b', 'c']);
    expect(moveId(['a', 'b'], 'a', 'a', true)).toEqual(['a', 'b']);
  });
});
