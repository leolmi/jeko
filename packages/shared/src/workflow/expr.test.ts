import { describe, expect, it } from 'vitest';
import {
  evalExpr,
  ExprError,
  kebab,
  orderedVars,
  parseExpr,
  references,
  renderTemplate,
} from './expr.js';

const vars = {
  type: 'semplice',
  name: 'Gestione Clienti 2.0',
  n: 3,
  tags: ['a', 'b'],
  p: { x: 1 },
};
const ev = (src: string) => evalExpr(src, { vars });

describe('espressioni', () => {
  it('confronti e logica', () => {
    expect(ev("type != 'vuoto'")).toBe(true);
    expect(ev("type == 'vuoto' || n > 2")).toBe(true);
    expect(ev('!(n >= 3) && true')).toBe(false);
    expect(ev("'a' in tags")).toBe(true);
    expect(ev("'emp' in type")).toBe(true);
    expect(ev('p.x == 1')).toBe(true);
  });

  it('variabili mancanti valgono null', () => {
    expect(ev('missing == null')).toBe(true);
    expect(ev('p.y.z')).toBe(null);
  });

  it('funzioni builtin e host', () => {
    expect(ev('kebab(name)')).toBe('gestione-clienti-2-0');
    expect(ev('len(tags) + 1')).toBe(3);
    expect(ev("default(missing, 'x')")).toBe('x');
    expect(evalExpr("exists('/tmp')", { vars: {}, functions: { exists: () => true } })).toBe(true);
  });

  it('rifiuta funzioni sconosciute e sintassi errata', () => {
    expect(() => ev('nope()')).toThrow(ExprError);
    expect(() => parseExpr('a ==')).toThrow(/incompleta/);
    expect(() => parseExpr("'aperta")).toThrow(/non chiusa/);
    expect(() => parseExpr('a; b')).toThrow(/non ammesso/);
  });

  it('elenca i riferimenti', () => {
    const r = references(parseExpr("exists(dir + '/x') && kebab(p.name) in list"));
    expect([...r.vars].sort()).toEqual(['dir', 'list', 'p']);
    expect([...r.functions].sort()).toEqual(['exists', 'kebab']);
  });

  it('template', () => {
    expect(renderTemplate('C:\\dev\\{{ kebab(name) }} ({{ n }})', { vars })).toBe(
      'C:\\dev\\gestione-clienti-2-0 (3)',
    );
    expect(renderTemplate('{{ missing }}!', { vars })).toBe('!');
  });

  it('kebab', () => {
    expect(kebab('  Perché è così?  ')).toBe('perche-e-cosi');
  });

  it('ordina le vars secondo le dipendenze, non secondo le chiavi', () => {
    // Come torna da jsonb: chiavi più corte prima.
    const order = orderedVars({
      dir: '{{ root }}/{{ slug }}',
      root: 'C:',
      slug: '{{ kebab(name) }}',
    });
    expect(order.map(([n]) => n)).toEqual(['root', 'slug', 'dir']);
  });
});
