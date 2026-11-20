/**
 * Mini-linguaggio delle espressioni dei workflow.
 *
 * Valori: stringhe ('…' o "…"), numeri, true, false, null, liste [a, b].
 * Variabili: nome o nome.campo. Una variabile non definita vale null.
 * Operatori, dal meno al più vincolante: ||  &&  !  == != < <= > >= in  + -
 * Funzioni: solo quelle registrate (builtin pure + quelle fornite dall'host).
 * Template: testo con {{ espressione }}.
 */

export type Value = string | number | boolean | null | Value[];

export type Fn = (...args: Value[]) => Value;
export type Functions = Readonly<Record<string, Fn>>;

export interface EvalContext {
  vars: Readonly<Record<string, unknown>>;
  functions?: Functions;
}

export type Node =
  | { kind: 'lit'; value: Value }
  | { kind: 'list'; items: Node[] }
  | { kind: 'var'; path: string[] }
  | { kind: 'call'; name: string; args: Node[] }
  | { kind: 'not'; arg: Node }
  | { kind: 'bin'; op: BinOp; left: Node; right: Node };

type BinOp = '||' | '&&' | '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | '+' | '-';

export class ExprError extends Error {
  constructor(
    message: string,
    readonly pos: number,
  ) {
    super(message);
    this.name = 'ExprError';
  }
}

// ---------- lexer ----------

type Tok =
  | { t: 'num'; v: number; pos: number }
  | { t: 'str'; v: string; pos: number }
  | { t: 'id'; v: string; pos: number }
  | { t: 'op'; v: string; pos: number }
  | { t: 'end'; pos: number };

const OPS = [
  '||',
  '&&',
  '==',
  '!=',
  '<=',
  '>=',
  '<',
  '>',
  '!',
  '+',
  '-',
  '(',
  ')',
  '[',
  ']',
  ',',
  '.',
];

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(c)) {
      const m = /^[0-9]+(\.[0-9]+)?/.exec(src.slice(i))!;
      out.push({ t: 'num', v: Number(m[0]), pos: i });
      i += m[0].length;
      continue;
    }
    if (c === "'" || c === '"') {
      const start = i++;
      let s = '';
      while (i < src.length && src[i] !== c) {
        if (src[i] === '\\' && i + 1 < src.length) i++;
        s += src[i++];
      }
      if (i >= src.length) throw new ExprError('Stringa non chiusa', start);
      i++;
      out.push({ t: 'str', v: s, pos: start });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      out.push({ t: 'id', v: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new ExprError(`Carattere non ammesso '${c}'`, i);
    out.push({ t: 'op', v: op, pos: i });
    i += op.length;
  }
  out.push({ t: 'end', pos: src.length });
  return out;
}

// ---------- parser ----------

export function parseExpr(src: string): Node {
  const toks = lex(src);
  let k = 0;
  const peek = () => toks[k]!;
  const isOp = (v: string) => {
    const t = peek();
    return t.t === 'op' && t.v === v;
  };
  const isWord = (v: string) => {
    const t = peek();
    return t.t === 'id' && t.v === v;
  };
  const expect = (v: string) => {
    if (!isOp(v)) throw new ExprError(`Atteso '${v}'`, peek().pos);
    k++;
  };

  const binary = (next: () => Node, ops: BinOp[]): (() => Node) => {
    return () => {
      let left = next();
      for (;;) {
        const op = ops.find((o) => (o === 'in' ? isWord('in') : isOp(o)));
        if (!op) return left;
        k++;
        left = { kind: 'bin', op, left, right: next() };
      }
    };
  };

  const primary = (): Node => {
    const t = peek();
    if (t.t === 'num' || t.t === 'str') {
      k++;
      return { kind: 'lit', value: t.v };
    }
    if (t.t === 'op' && t.v === '(') {
      k++;
      const e = expr();
      expect(')');
      return e;
    }
    if (t.t === 'op' && t.v === '[') {
      k++;
      const items: Node[] = [];
      if (!isOp(']')) {
        do items.push(expr());
        while (isOp(',') && ++k);
      }
      expect(']');
      return { kind: 'list', items };
    }
    if (t.t === 'id') {
      k++;
      if (t.v === 'true') return { kind: 'lit', value: true };
      if (t.v === 'false') return { kind: 'lit', value: false };
      if (t.v === 'null') return { kind: 'lit', value: null };
      if (isOp('(')) {
        k++;
        const args: Node[] = [];
        if (!isOp(')')) {
          do args.push(expr());
          while (isOp(',') && ++k);
        }
        expect(')');
        return { kind: 'call', name: t.v, args };
      }
      const path = [t.v];
      while (isOp('.')) {
        k++;
        const p = peek();
        if (p.t !== 'id') throw new ExprError('Atteso un nome dopo il punto', p.pos);
        k++;
        path.push(p.v);
      }
      return { kind: 'var', path };
    }
    throw new ExprError(t.t === 'end' ? 'Espressione incompleta' : 'Token inatteso', t.pos);
  };

  const additive = binary(primary, ['+', '-']);
  const comparison = (): Node => {
    const left = additive();
    const op = (['==', '!=', '<=', '>=', '<', '>', 'in'] as const).find((o) =>
      o === 'in' ? isWord('in') : isOp(o),
    );
    if (!op) return left;
    k++;
    return { kind: 'bin', op, left, right: additive() };
  };
  const negation = (): Node => {
    if (isOp('!')) {
      k++;
      return { kind: 'not', arg: negation() };
    }
    return comparison();
  };
  const and = binary(negation, ['&&']);
  const expr = binary(and, ['||']);

  const root = expr();
  if (peek().t !== 'end') throw new ExprError('Token inatteso', peek().pos);
  return root;
}

// ---------- valutazione ----------

export function truthy(v: Value): boolean {
  if (Array.isArray(v)) return v.length > 0;
  return v !== null && v !== false && v !== 0 && v !== '';
}

function toValue(v: unknown): Value {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (Array.isArray(v)) return v.map(toValue);
  return null;
}

function lookup(vars: Readonly<Record<string, unknown>>, path: string[]): Value {
  let cur: unknown = vars;
  for (const p of path) {
    if (cur === null || typeof cur !== 'object' || !Object.hasOwn(cur, p)) return null;
    cur = (cur as Record<string, unknown>)[p];
  }
  return toValue(cur);
}

function compare(op: '<' | '<=' | '>' | '>=', a: Value, b: Value): boolean {
  const ok =
    (typeof a === 'number' && typeof b === 'number') ||
    (typeof a === 'string' && typeof b === 'string');
  if (!ok) throw new ExprError(`'${op}' vuole due numeri o due stringhe`, -1);
  const x = a as number | string;
  const y = b as number | string;
  return op === '<' ? x < y : op === '<=' ? x <= y : op === '>' ? x > y : x >= y;
}

export function evaluate(node: Node, ctx: EvalContext): Value {
  const fns: Functions = { ...builtins, ...ctx.functions };
  const ev = (n: Node): Value => {
    switch (n.kind) {
      case 'lit':
        return n.value;
      case 'list':
        return n.items.map(ev);
      case 'var':
        return lookup(ctx.vars, n.path);
      case 'not':
        return !truthy(ev(n.arg));
      case 'call': {
        const fn = Object.hasOwn(fns, n.name) ? fns[n.name] : undefined;
        if (!fn) throw new ExprError(`Funzione sconosciuta '${n.name}'`, -1);
        return fn(...n.args.map(ev));
      }
      case 'bin': {
        if (n.op === '||') return truthy(ev(n.left)) || truthy(ev(n.right));
        if (n.op === '&&') return truthy(ev(n.left)) && truthy(ev(n.right));
        const a = ev(n.left);
        const b = ev(n.right);
        switch (n.op) {
          case '==':
            return a === b;
          case '!=':
            return a !== b;
          case 'in':
            if (Array.isArray(b)) return b.includes(a);
            if (typeof b === 'string' && typeof a === 'string') return b.includes(a);
            return false;
          case '+':
            if (typeof a === 'number' && typeof b === 'number') return a + b;
            return str(a) + str(b);
          case '-':
            if (typeof a === 'number' && typeof b === 'number') return a - b;
            throw new ExprError("'-' vuole due numeri", -1);
          default:
            return compare(n.op, a, b);
        }
      }
    }
  };
  return ev(node);
}

export function evalExpr(src: string, ctx: EvalContext): Value {
  return evaluate(parseExpr(src), ctx);
}

/** Nomi delle variabili radice e delle funzioni usate da un'espressione. */
export function references(node: Node): { vars: Set<string>; functions: Set<string> } {
  const vars = new Set<string>();
  const functions = new Set<string>();
  const walk = (n: Node): void => {
    if (n.kind === 'var') vars.add(n.path[0]!);
    else if (n.kind === 'call') {
      functions.add(n.name);
      n.args.forEach(walk);
    } else if (n.kind === 'list') n.items.forEach(walk);
    else if (n.kind === 'not') walk(n.arg);
    else if (n.kind === 'bin') {
      walk(n.left);
      walk(n.right);
    }
  };
  walk(node);
  return { vars, functions };
}

// ---------- template ----------

export type TemplatePart = { text: string } | { expr: Node; src: string; pos: number };

export function parseTemplate(src: string): TemplatePart[] {
  const parts: TemplatePart[] = [];
  let i = 0;
  for (;;) {
    const open = src.indexOf('{{', i);
    if (open < 0) break;
    const close = src.indexOf('}}', open + 2);
    if (close < 0) throw new ExprError("'{{' senza '}}'", open);
    if (open > i) parts.push({ text: src.slice(i, open) });
    const inner = src.slice(open + 2, close);
    try {
      parts.push({ expr: parseExpr(inner), src: inner.trim(), pos: open });
    } catch (e) {
      if (e instanceof ExprError) throw new ExprError(e.message, open + 2 + e.pos);
      throw e;
    }
    i = close + 2;
  }
  if (i < src.length) parts.push({ text: src.slice(i) });
  return parts;
}

/**
 * Le `vars` in un ordine in cui ognuna viene dopo quelle che usa. L'ordine scritto nello YAML
 * non basta: un oggetto salvato come jsonb torna con le chiavi riordinate (es. `dir` prima di
 * `slug`). La validazione esclude i cicli; se ce ne fosse uno, il resto segue l'ordine dato.
 */
export function orderedVars(vars: Readonly<Record<string, string>>): [string, string][] {
  const pending = new Map(Object.entries(vars));
  const uses = new Map<string, Set<string>>();
  for (const [name, tpl] of pending) {
    const refs = new Set<string>();
    for (const p of parseTemplate(tpl)) {
      if ('expr' in p) for (const v of references(p.expr).vars) if (v !== name) refs.add(v);
    }
    uses.set(name, refs);
  }
  const out: [string, string][] = [];
  while (pending.size) {
    const ready = [...pending].find(([n]) => [...uses.get(n)!].every((v) => !pending.has(v)));
    const [name, tpl] = ready ?? [...pending][0]!;
    out.push([name, tpl]);
    pending.delete(name);
  }
  return out;
}

export function renderTemplate(src: string, ctx: EvalContext): string {
  return parseTemplate(src)
    .map((p) => ('text' in p ? p.text : str(evaluate(p.expr, ctx))))
    .join('');
}

// ---------- funzioni builtin (pure) ----------

function str(v: Value): string {
  if (v === null) return '';
  if (Array.isArray(v)) return v.map(str).join(', ');
  return String(v);
}

function needString(name: string, v: Value): string {
  if (typeof v !== 'string') throw new ExprError(`${name}() vuole una stringa`, -1);
  return v;
}

export function kebab(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const builtins: Functions = {
  kebab: (s = null) => kebab(needString('kebab', s)),
  lower: (s = null) => needString('lower', s).toLowerCase(),
  upper: (s = null) => needString('upper', s).toUpperCase(),
  trim: (s = null) => needString('trim', s).trim(),
  len: (v = null) => (Array.isArray(v) || typeof v === 'string' ? v.length : 0),
  empty: (v = null) => !truthy(v),
  default: (v = null, d = null) => (v === null || v === '' ? d : v),
  startsWith: (s = null, p = null) =>
    needString('startsWith', s).startsWith(needString('startsWith', p)),
  endsWith: (s = null, p = null) => needString('endsWith', s).endsWith(needString('endsWith', p)),
  join: (list = null, sep = '/') =>
    Array.isArray(list) ? list.map(str).join(str(sep)) : str(list),
};

/** Funzioni che l'host (runner) deve fornire: dipendono dal file system. */
export const HOST_FUNCTIONS = ['exists', 'isDir', 'isEmptyDir', 'fileContains'] as const;
export type HostFunction = (typeof HOST_FUNCTIONS)[number];

export const KNOWN_FUNCTIONS: ReadonlySet<string> = new Set([
  ...Object.keys(builtins),
  ...HOST_FUNCTIONS,
]);
