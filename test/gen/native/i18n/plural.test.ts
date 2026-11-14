import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildDriver, hasClang, VECTORS } from './helper.ts';
import type { Driver } from './helper.ts';

const vectors = JSON.parse(readFileSync(VECTORS, 'utf8'));
let d: Driver;
const plural = (formula: string, n: number | string) => Number(d.run('plural', formula, String(n)));

describe('given the C++ gettext plural evaluator', { skip: !hasClang && 'clang++ not installed' }, () => {
  before(() => { d = buildDriver(); });
  after(() => d.dispose());

  for (const c of vectors.plural as { name: string; formula: string; cases: [number, number][] }[]) {
    for (const [n, expected] of c.cases) {
      it(`when ${c.name} (${c.formula}) gets n=${n}, then the form index is ${expected}`, () => {
        assert.equal(plural(c.formula, n), expected);
      });
    }
  }

  for (const formula of vectors.invalidFormulas as string[]) {
    it(`when the formula is ${JSON.stringify(formula).slice(0, 40)}, then the index is -1`, () => {
      assert.equal(plural(formula, 1), -1);
    });
  }

  it('when the formula divides by zero with %, then the index is -1 and nothing crashes', () => {
    assert.equal(plural('n % 0', 5), -1);
    assert.equal(plural('1 ? n % (n - n) : 0', 5), -1);
  });
  it('when the zero divisor sits in a branch that is not taken, then the formula still evaluates', () => {
    assert.equal(plural('n == 1 ? 0 : 1 % 1', 1), 0);
  });
  it('when n is negative or the result is negative, then the result is -1 for the negative result', () => {
    assert.equal(plural('n', -3), -1);
    assert.equal(plural('n > 1', -3), 0);
  });
  it('when the formula has spaces, a leading !, comparisons and || chains, then they follow C precedence', () => {
    assert.equal(plural(' ! (n == 1) ', 3), 1);
    assert.equal(plural('n==0 || n==1 ? 0 : 1', 1), 0);
    assert.equal(plural('1 || 0 && 0', 0), 1);
    assert.equal(plural('n <= 1 == 1', 1), 1);
  });
  it('when the Arabic six-form formula is used, then each class maps to its form', () => {
    const ar = 'n==0 ? 0 : n==1 ? 1 : n==2 ? 2 : n%100>=3 && n%100<=10 ? 3 : n%100>=11 ? 4 : 5';
    assert.deepEqual([0, 1, 2, 5, 11, 100].map((n) => plural(ar, n)), [0, 1, 2, 3, 4, 5]);
  });
  it('when a number literal has too many digits to fit, then the formula is invalid', () => {
    assert.equal(plural('99999999999999999999999', 1), -1);
  });
  it('when the formula is longer than the size limit, then it is invalid', () => {
    assert.equal(plural('1' + ' || 0'.repeat(200), 1), -1);
  });
  it('when the nesting is 20 deep, then it is accepted and 40 deep is rejected', () => {
    assert.equal(plural('('.repeat(20) + 'n' + ')'.repeat(20), 3), 3);
    assert.equal(plural('('.repeat(40) + 'n' + ')'.repeat(40), 3), -1);
  });
  it('when a ternary chain nests deeper than the limit, then it is rejected, not a stack overflow', () => {
    assert.equal(plural('n ? 1 : '.repeat(60) + '0', 0), -1);
  });
  it('when the formula has calls, assignment, strings or other operators, then it is -1', () => {
    for (const f of ['n(1)', 'n = 2', 'n & 1', 'n | 1', 'n * 2', 'n + 1', 'n / 2', '"a"', 'n == n == ', '0x10', '1e3', '$n', 'N'])
      assert.equal(plural(f, 1), -1, f);
  });
});
