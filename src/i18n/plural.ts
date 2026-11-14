// Safe gettext plural-expression evaluator and the built-in plural table.
//
// Closed grammar, no eval/Function: identifier `n`, non-negative integer
// literals, parentheses, unary `!`, binary `* / % + - < > <= >= == != && ||`
// and the ternary `?:` (C precedence).
//
// Decisions:
// - Arithmetic is 32-bit signed with wrap-around (Math.imul / |0), so it is
//   deterministic and easy to mirror in C++ with int32_t/uint32_t.
// - Division or modulo by a literal zero is a compile-time error; by a
//   computed zero it evaluates to 0 at runtime (never throws, never NaN).
// - `n` is coerced to a non-negative integer (abs, truncate; NaN/Infinity -> 0)
//   and the result is clamped to >= 0, so it is always a valid index.
// - Limits: formula text <= 512 chars, <= 256 tokens, nesting depth <= 32,
//   literals <= 9 digits.
import { normalizeTag } from './locale.ts';

const MAX_TEXT = 512;
const MAX_TOKENS = 256;
const MAX_DEPTH = 32;
const MAX_LITERAL_DIGITS = 9;

type Tok = { t: 'num'; v: number } | { t: 'n' } | { t: 'op'; v: string };
type Fn = (n: number) => number;

function fail(msg: string): never {
  throw new Error(`invalid plural formula: ${msg}`);
}

function tokenize(src: string): Tok[] {
  if (src.length > MAX_TEXT) fail(`too long (more than ${MAX_TEXT} characters)`);
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t') {
      i++;
      continue;
    }
    if (toks.length >= MAX_TOKENS) fail(`too long (more than ${MAX_TOKENS} tokens)`);
    if (c >= '0' && c <= '9') {
      let j = i;
      while (j < src.length && src[j] >= '0' && src[j] <= '9') j++;
      if (j - i > MAX_LITERAL_DIGITS) fail('number literal too large');
      toks.push({ t: 'num', v: Number(src.slice(i, j)) });
      i = j;
    } else if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_') {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      const id = src.slice(i, j);
      if (id !== 'n') fail(`unknown identifier "${id}"`);
      toks.push({ t: 'n' });
      i = j;
    } else {
      const two = src.slice(i, i + 2);
      if (['<=', '>=', '==', '!=', '&&', '||'].includes(two)) {
        toks.push({ t: 'op', v: two });
        i += 2;
      } else if ('*/%+-<>!?:()'.includes(c)) {
        toks.push({ t: 'op', v: c });
        i++;
      } else if (c === '=' || c === '&' || c === '|') {
        fail(`unexpected "${c}"`);
      } else {
        fail(`unexpected character "${c}"`);
      }
    }
  }
  if (toks.length > MAX_TOKENS) fail(`too long (more than ${MAX_TOKENS} tokens)`);
  return toks;
}

const BINARY: string[][] = [['||'], ['&&'], ['==', '!='], ['<', '>', '<=', '>='], ['+', '-'], ['*', '/', '%']];

const APPLY: Record<string, (a: number, b: number) => number> = {
  '||': (a, b) => (a !== 0 || b !== 0 ? 1 : 0),
  '&&': (a, b) => (a !== 0 && b !== 0 ? 1 : 0),
  '==': (a, b) => (a === b ? 1 : 0),
  '!=': (a, b) => (a !== b ? 1 : 0),
  '<': (a, b) => (a < b ? 1 : 0),
  '>': (a, b) => (a > b ? 1 : 0),
  '<=': (a, b) => (a <= b ? 1 : 0),
  '>=': (a, b) => (a >= b ? 1 : 0),
  '+': (a, b) => (a + b) | 0,
  '-': (a, b) => (a - b) | 0,
  '*': (a, b) => Math.imul(a, b),
  '/': (a, b) => (b === 0 ? 0 : (Math.trunc(a / b) | 0)),
  '%': (a, b) => (b === 0 ? 0 : (a % b) | 0),
};

class Parser {
  pos = 0;
  depth = 0;
  toks: Tok[];
  constructor(toks: Tok[]) {
    this.toks = toks;
  }

  peekOp(): string | undefined {
    const t = this.toks[this.pos];
    return t && t.t === 'op' ? t.v : undefined;
  }
  enter(): void {
    if (++this.depth > MAX_DEPTH) fail(`too deeply nested (more than ${MAX_DEPTH} levels)`);
  }
  describe(): string {
    const t = this.toks[this.pos];
    if (!t) return 'end of formula';
    return t.t === 'op' ? `"${t.v}"` : t.t === 'n' ? '"n"' : `number ${t.v}`;
  }

  parse(): Fn {
    if (this.toks.length === 0) fail('empty formula');
    const f = this.ternary();
    if (this.pos < this.toks.length) fail(`unexpected ${this.describe()}`);
    return f;
  }

  ternary(): Fn {
    const cond = this.binary(0);
    let result = cond;
    if (this.peekOp() === '?') {
      this.pos++;
      this.enter();
      const a = this.ternary();
      if (this.peekOp() !== ':') fail(`expected ":" but found ${this.describe()}`);
      this.pos++;
      const b = this.ternary();
      this.depth--;
      result = (n) => (cond(n) !== 0 ? a(n) : b(n));
    }
    return result;
  }

  binary(level: number): Fn {
    if (level === BINARY.length) return this.unary();
    let left = this.binary(level + 1);
    for (;;) {
      const op = this.peekOp();
      if (op === undefined || !BINARY[level].includes(op)) return left;
      this.pos++;
      const divisor = this.toks[this.pos];
      if ((op === '/' || op === '%') && divisor && divisor.t === 'num' && divisor.v === 0) {
        fail('division by zero');
      }
      const right = this.binary(level + 1);
      const l = left;
      const apply = APPLY[op];
      left = (n) => apply(l(n), right(n));
    }
  }

  unary(): Fn {
    if (this.peekOp() === '!') {
      this.pos++;
      this.enter();
      const inner = this.unary();
      this.depth--;
      return (n) => (inner(n) === 0 ? 1 : 0);
    }
    return this.primary();
  }

  primary(): Fn {
    const t = this.toks[this.pos];
    if (!t) fail('unexpected end of formula');
    if (t.t === 'num') {
      this.pos++;
      const v = t.v;
      return () => v;
    }
    if (t.t === 'n') {
      this.pos++;
      return (n) => n;
    }
    if (t.v === '(') {
      this.pos++;
      this.enter();
      const inner = this.ternary();
      this.depth--;
      if (this.peekOp() !== ')') fail(`expected ")" but found ${this.describe()}`);
      this.pos++;
      return inner;
    }
    return fail(`unexpected ${this.describe()}`);
  }
}

/** Compiles a gettext plural expression into a function n -> form index. */
export function compilePlural(formula: string): (n: number) => number {
  const f = new Parser(tokenize(formula)).parse();
  return (n: number) => {
    const m = Number.isFinite(n) ? Math.min(Math.trunc(Math.abs(n)), 0x7fffffff) : 0;
    return Math.max(0, f(m));
  };
}

const OTHER_SLAVIC = 'n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2';

// Formulas follow the standard gettext plural-forms headers.
const TABLE: Record<string, { nplurals: number; formula: string }> = {
  en: { nplurals: 2, formula: 'n != 1' },
  pt: { nplurals: 2, formula: 'n > 1' },
  fr: { nplurals: 2, formula: 'n > 1' },
  ja: { nplurals: 1, formula: '0' },
  zh: { nplurals: 1, formula: '0' },
  ko: { nplurals: 1, formula: '0' },
  ru: { nplurals: 3, formula: `n%10==1 && n%100!=11 ? 0 : ${OTHER_SLAVIC}` },
  pl: { nplurals: 3, formula: `n==1 ? 0 : ${OTHER_SLAVIC}` },
  cs: { nplurals: 3, formula: '(n==1) ? 0 : (n>=2 && n<=4) ? 1 : 2' },
  ar: {
    nplurals: 6,
    formula: 'n==0 ? 0 : n==1 ? 1 : n==2 ? 2 : n%100>=3 && n%100<=10 ? 3 : n%100>=11 ? 4 : 5',
  },
};

/** Plural forms of a locale (by language); unknown languages use English's rule. */
export function pluralFormsFor(tag: string): { nplurals: number; formula: string } {
  const lang = (normalizeTag(tag) ?? 'en').split('-')[0];
  const row = Object.hasOwn(TABLE, lang) ? TABLE[lang] : TABLE.en;
  return { nplurals: row.nplurals, formula: row.formula };
}
