import { modelLabel } from './agent-choice';

describe('nome dei modelli', () => {
  it('rende leggibili alias e nomi completi', () => {
    expect(modelLabel('opus')).toBe('Opus');
    expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5');
    expect(modelLabel('claude-sonnet-4-5-20250929')).toBe('Sonnet 4.5');
    expect(modelLabel('claude-opus-4-6[1m]')).toBe('Opus 4.6');
    expect(modelLabel('modello-strano')).toBe('modello-strano');
  });
});
