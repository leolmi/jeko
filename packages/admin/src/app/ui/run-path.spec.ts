import type { StepMark } from '@jeko/shared';
import { collapsePath } from './run-path';

describe('pallini del percorso', () => {
  it('una sequenza corta resta intera', () => {
    expect(collapsePath(['done', 'current', 'pending'])).toHaveLength(3);
  });

  it('una sequenza lunga mostra i primi, "…" e gli ultimi', () => {
    const path = Array.from({ length: 20 }, (_, i): StepMark => (i < 19 ? 'done' : 'current'));
    const items = collapsePath(path, 12, 5);
    expect(items).toHaveLength(11);
    expect(items[5]).toEqual({ gap: true });
    expect(items.at(-1)).toEqual({ mark: 'current' });
  });
});
