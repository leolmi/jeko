import { diffLines } from './diff';

describe('diffLines', () => {
  it('segna righe uguali, aggiunte e tolte', () => {
    const d = diffLines('a\nb\nc\n', 'a\nx\nc\nd\n');
    expect(d.map((l) => `${l.kind}:${l.text}`)).toEqual([
      'same:a',
      'del:b',
      'add:x',
      'same:c',
      'add:d',
    ]);
  });

  it('testi uguali: nessuna differenza', () => {
    expect(diffLines('a\nb', 'a\nb\n').every((l) => l.kind === 'same')).toBe(true);
  });
});
