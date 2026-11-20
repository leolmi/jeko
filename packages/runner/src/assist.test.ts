import { describe, expect, it } from 'vitest';
import { parseResult } from './assist.js';

describe('assistenza', () => {
  it('legge il testo del risultato di claude', () => {
    expect(parseResult(JSON.stringify({ type: 'result', result: 'ciao', is_error: false }))).toBe(
      'ciao',
    );
  });

  it('segnala errori e uscite illeggibili', () => {
    expect(() => parseResult(JSON.stringify({ is_error: true, result: 'limite' }))).toThrow(
      'limite',
    );
    expect(() => parseResult('non json')).toThrow('non leggibile');
  });
});
