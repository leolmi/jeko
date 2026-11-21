import { formatDate, formatDayMonth, formatTime } from './formats';

describe('formati', () => {
  const d = new Date(2026, 10, 5, 14, 7);

  it('la data segue il formato scelto', () => {
    expect(formatDate(d, 'dmy', 'en')).toBe('05/11/2026');
    expect(formatDate(d, 'mdy', 'it')).toBe('11/05/2026');
    expect(formatDate(d, 'ymd', 'it')).toBe('2026-11-05');
    expect(formatDate(d, 'auto', 'it')).toBe('05/11/2026');
  });

  it('giorno e mese brevi nell’ordine del formato', () => {
    expect(formatDayMonth(d, 'dmy', 'it')).toBe('5 nov');
    expect(formatDayMonth(d, 'mdy', 'en')).toBe('Nov 5');
    expect(formatDayMonth(d, 'ymd', 'en')).toBe('11-05');
  });

  it('ora a 24 o a 12 ore', () => {
    expect(formatTime(d, 'h24', 'en')).toBe('14:07');
    expect(formatTime(d, 'h12', 'it')).toMatch(/^02:07\s?PM$/i);
  });
});
