import { UserSettingsSchema } from '@jeko/shared';
import { describe, expect, it } from 'vitest';
import { prune } from './store.js';

describe('opzioni salvate', () => {
  it('lascia intatte le opzioni valide', () => {
    const s = { projectsDir: 'C:\\dev', formats: { date: 'ymd', rates: { EUR: 0.9 } } };
    expect(prune(UserSettingsSchema, s)).toEqual(s);
  });

  it('toglie campi sconosciuti e valori non validi, tenendo il resto', () => {
    const s = {
      projectsDir: 'C:\\dev',
      futuro: true,
      formats: { date: 'ymd', currency: 'JPY', altro: 1, rates: { EUR: 0.9, GBP: -1 } },
    };
    expect(prune(UserSettingsSchema, s)).toEqual({
      projectsDir: 'C:\\dev',
      formats: { date: 'ymd', rates: { EUR: 0.9 } },
    });
  });

  it('un valore che non è un oggetto si scarta', () => {
    expect(prune(UserSettingsSchema, 'x')).toBeUndefined();
  });
});
