import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compilePlural, pluralFormsFor } from '../../src/i18n/plural.ts';

const vectors = JSON.parse(readFileSync(new URL('../fixtures/i18n/vectors.json', import.meta.url), 'utf8'));

describe('given the shared plural vectors', () => {
  for (const v of vectors.plural) {
    it(`when evaluating the ${v.name} formula then every n gives the expected form`, () => {
      const f = compilePlural(v.formula);
      for (const [n, expected] of v.cases) assert.equal(f(n), expected, `${v.name}: n=${n}`);
    });
    it(`when asking the table for ${v.name} then nplurals and the formula match the vectors`, () => {
      const forms = pluralFormsFor(v.name);
      assert.equal(forms.nplurals, v.nplurals);
      assert.equal(compilePlural(forms.formula)(0), v.cases.find((c: number[]) => c[0] === 0)[1]);
    });
  }
});

describe('given invalid or hostile formulas', () => {
  for (const formula of vectors.invalidFormulas) {
    it(`when compiling ${JSON.stringify(formula).slice(0, 50)} then it throws`, () => {
      assert.throws(() => compilePlural(formula), /plural/i);
    });
  }
  it('when it uses a call, a property, an assignment or a string then the message names the problem', () => {
    assert.throws(() => compilePlural('alert(1)'), /unknown identifier "alert"/);
    assert.throws(() => compilePlural('n = 1'), /unexpected "="/);
    assert.throws(() => compilePlural('n.constructor'), /unexpected character "\."/);
    assert.throws(() => compilePlural('n == "a"'), /unexpected character/);
  });
  it('when nesting is exactly 32 deep then it compiles, 33 deep it throws', () => {
    const nest = (d: number) => '('.repeat(d) + 'n' + ')'.repeat(d);
    assert.equal(compilePlural(nest(32))(7), 7);
    assert.throws(() => compilePlural(nest(33)), /too deeply nested/);
  });
  it('when a ternary chain is deeper than 32 then it throws', () => {
    assert.throws(() => compilePlural('n ? 1 : '.repeat(40) + '0'), /too deeply nested/);
  });
  it('when a unary chain is deeper than 32 then it throws', () => {
    assert.throws(() => compilePlural('!'.repeat(40) + 'n'), /too deeply nested/);
  });
  it('when the formula has too many tokens then it throws', () => {
    assert.throws(() => compilePlural(Array(300).fill('n').join(' + ')), /too long/);
  });
  it('when the formula text is huge then it throws without scanning it all', () => {
    assert.throws(() => compilePlural('n' + ' '.repeat(100000)), /too long/);
  });
  it('when a literal is too large then it throws', () => {
    assert.throws(() => compilePlural('n == 99999999999'), /too large/);
  });
  it('when it uses a prototype-ish name or a NUL then it throws', () => {
    assert.throws(() => compilePlural('__proto__'), /plural/i);
    assert.throws(() => compilePlural('n\0'), /plural/i);
  });
  it('when dividing or taking the modulo by a literal zero then it throws at compile time', () => {
    assert.throws(() => compilePlural('n / 0'), /division by zero/);
    assert.throws(() => compilePlural('n % 0'), /division by zero/);
  });
});

describe('given arithmetic', () => {
  it('when the divisor is zero at runtime then the result is 0 (characterization of the safe choice)', () => {
    assert.equal(compilePlural('n % (n - n)')(5), 0);
    assert.equal(compilePlural('n / (n - n)')(5), 0);
  });
  it('when dividing then the result is an integer (truncated)', () => {
    assert.equal(compilePlural('n / 2')(7), 3);
  });
  it('when comparing then booleans are 0 or 1 and ! negates', () => {
    assert.equal(compilePlural('!n')(0), 1);
    assert.equal(compilePlural('!n')(3), 0);
    assert.equal(compilePlural('!!n')(3), 1);
    assert.equal(compilePlural('n >= 2')(2), 1);
    assert.equal(compilePlural('n <= 1')(2), 0);
  });
  it('when mixing operators then C precedence applies', () => {
    assert.equal(compilePlural('1 + 2 * 3')(0), 7);
    assert.equal(compilePlural('(1 + 2) * 3')(0), 9);
    assert.equal(compilePlural('10 - 3 - 2')(0), 5);
    assert.equal(compilePlural('1 || 0 && 0')(0), 1);
    assert.equal(compilePlural('1 == 1 == 1')(0), 1);
    assert.equal(compilePlural('n ? 1 : 0 ? 2 : 3')(0), 3);
  });
  it('when the result is negative then it is clamped to 0', () => {
    assert.equal(compilePlural('n - 5')(1), 0);
  });
  it('when the arithmetic overflows then it wraps like 32-bit C ints and stays finite', () => {
    const f = compilePlural('n * n * n * n * n * n * n * n');
    assert.ok(Number.isInteger(f(1000000)));
    assert.equal(compilePlural('999999999 * 3 < 0')(0), 1);
  });
  it('when n is odd (negative, fractional, NaN, Infinity) then it is coerced to a non-negative integer', () => {
    const f = compilePlural('n');
    assert.equal(f(-3), 3);
    assert.equal(f(2.9), 2);
    assert.equal(f(NaN), 0);
    assert.equal(f(Infinity), 0);
  });
});

describe('given the built-in plural table', () => {
  const check = (tag: string, nplurals: number, cases: [number, number][]) => {
    const forms = pluralFormsFor(tag);
    assert.equal(forms.nplurals, nplurals, `${tag} nplurals`);
    const f = compilePlural(forms.formula);
    for (const [n, want] of cases) assert.equal(f(n), want, `${tag} n=${n}`);
  };
  it('when asking for en and en-GB then n != 1', () => {
    check('en', 2, [[0, 1], [1, 0], [2, 1]]);
    check('en-GB', 2, [[0, 1], [1, 0], [2, 1]]);
    assert.equal(pluralFormsFor('en').formula, 'n != 1');
  });
  it('when asking for pt-BR, pt and pt-PT then n > 1', () => {
    for (const t of ['pt-BR', 'pt', 'pt-PT']) check(t, 2, [[0, 0], [1, 0], [2, 1]]);
    assert.equal(pluralFormsFor('pt-BR').formula, 'n > 1');
  });
  it('when asking for ja, zh-CN and ko then a single form', () => {
    for (const t of ['ja', 'zh-CN', 'ko']) check(t, 1, [[0, 0], [1, 0], [9, 0]]);
  });
  it('when asking for fr then n > 1', () => {
    check('fr', 2, [[0, 0], [1, 0], [2, 1]]);
  });
  it('when asking for pl then three forms', () => {
    check('pl', 3, [[1, 0], [2, 1], [4, 1], [5, 2], [12, 2], [22, 1], [25, 2], [112, 2], [0, 2]]);
  });
  it('when asking for ru then three forms', () => {
    check('ru', 3, [[1, 0], [21, 0], [2, 1], [24, 1], [5, 2], [11, 2], [111, 2]]);
  });
  it('when asking for cs then three forms', () => {
    check('cs', 3, [[1, 0], [2, 1], [4, 1], [5, 2], [0, 2]]);
  });
  it('when asking for ar then six forms', () => {
    check('ar', 6, [[0, 0], [1, 1], [2, 2], [3, 3], [10, 3], [11, 4], [99, 4], [100, 5], [102, 5], [111, 4]]);
  });
  it('when the tag is unknown, odd-cased or has underscores then it falls back sensibly', () => {
    check('xx', 2, [[1, 0], [2, 1]]);
    check('', 2, [[1, 0], [2, 1]]);
    check('RU_ru', 3, [[1, 0], [2, 1], [5, 2]]);
  });
  it('when every table formula is compiled then it uses only indexes below nplurals', () => {
    for (const t of ['en', 'pt-BR', 'ja', 'fr', 'ru', 'pl', 'cs', 'ar']) {
      const { nplurals, formula } = pluralFormsFor(t);
      const f = compilePlural(formula);
      for (let n = 0; n < 300; n++) assert.ok(f(n) < nplurals, `${t} n=${n}`);
    }
  });
});
