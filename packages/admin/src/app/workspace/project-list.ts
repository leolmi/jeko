import type { ProjectView } from '../core/projects';

export type Sort = 'activity' | 'waiting' | 'name';
export const SORTS: Sort[] = ['activity', 'waiting', 'name'];

/** Preferiti nel loro ordine: non dipendono da ricerca e ordinamento. */
export function favoritesOf(views: ProjectView[]): ProjectView[] {
  return views
    .filter((p) => p.favorite !== undefined)
    .sort((a, b) => (a.favorite ?? 0) - (b.favorite ?? 0));
}

/** Gli altri progetti: senza i preferiti, filtrati dalla ricerca e ordinati. */
export function othersOf(views: ProjectView[], query: string, by: Sort): ProjectView[] {
  const q = query.trim().toLowerCase();
  return views
    .filter((p) => p.favorite === undefined)
    .filter((p) => !q || p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q))
    .sort((a, b) =>
      by === 'name'
        ? a.name.localeCompare(b.name)
        : by === 'waiting'
          ? b.waiting - a.waiting || b.open.length - a.open.length || b.last.localeCompare(a.last)
          : b.last.localeCompare(a.last),
    );
}

/** Sposta `id` al posto di `target` (prima o dopo); restituisce i nuovi id. */
export function moveId(ids: string[], id: string, target: string, after: boolean): string[] {
  if (id === target || !ids.includes(id) || !ids.includes(target)) return ids;
  const rest = ids.filter((x) => x !== id);
  const at = rest.indexOf(target) + (after ? 1 : 0);
  return [...rest.slice(0, at), id, ...rest.slice(at)];
}
