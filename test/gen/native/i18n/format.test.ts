import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildDriver, hasClang } from './helper.ts';
import type { Driver } from './helper.ts';

let d: Driver;
const fmt = (pattern: string, ...args: string[]) => {
  const out = d.run('format', pattern, ...args);
  assert.ok(out.startsWith('[') && out.endsWith(']\n'));
  return out.slice(1, -2);
};

describe('given the C++ sprintf subset', { skip: !hasClang && 'clang++ not installed' }, () => {
  before(() => { d = buildDriver(); });
  after(() => d.dispose());

  it('when the pattern has %s and %d, then the arguments fill them in order', () => {
    assert.equal(fmt('%s has %d files', 'Ana', '3'), 'Ana has 3 files');
  });
  it('when the pattern has positional %2$s %1$s, then the order follows the numbers (translators reorder)', () => {
    assert.equal(fmt('%2$s, %1$s', 'world', 'Hello'), 'Hello, world');
  });
  it('when the same position is used twice, then the argument repeats', () => {
    assert.equal(fmt('%1$s-%1$s', 'a'), 'a-a');
  });
  it('when positional %1$d is used, then the argument is printed as a number', () => {
    assert.equal(fmt('%1$d items', '12'), '12 items');
  });
  it('when the pattern has %%, then it prints one percent sign and consumes no argument', () => {
    assert.equal(fmt('100%% of %s', 'it'), '100% of it');
  });
  it('when there are no specifiers, then the text is returned unchanged (including UTF-8)', () => {
    assert.equal(fmt('Olá, mundo'), 'Olá, mundo');
  });
  it('when there are fewer arguments than specifiers, then the leftover specifiers stay as they are', () => {
    assert.equal(fmt('%s and %s', 'a'), 'a and %s');
    assert.equal(fmt('%2$s'), '%2$s');
  });
  it('when there are extra arguments, then they are ignored', () => {
    assert.equal(fmt('%s', 'a', 'b', 'c'), 'a');
  });
  it('when a position is 0 or points past the arguments, then the specifier stays as it is', () => {
    assert.equal(fmt('%0$s %3$s', 'a', 'b'), '%0$s %3$s');
  });
  it('when numbered and plain specifiers mix, then plain ones count on their own', () => {
    assert.equal(fmt('%2$s %s %s', 'a', 'b'), 'b a b');
  });
  it('when %d gets a number with a sign, then the sign is kept; leading zeros are dropped', () => {
    assert.equal(fmt('%d %d %d', '-5', '+7', '007'), '-5 7 7');
  });
  it('when %d gets a non-numeric argument, then it prints 0 like PHP; a numeric prefix is used (characterization)', () => {
    assert.equal(fmt('%d|%d|%d', 'abc', '12abc', ''), '0|12|0');
  });
  it('when %d gets a huge number, then it clamps instead of overflowing', () => {
    assert.equal(fmt('%d', '99999999999999999999999999'), '9223372036854775807');
    assert.equal(fmt('%d', '-99999999999999999999999999'), '-9223372036854775808');
  });
  it('when %s gets an argument that looks like a specifier, then it is not expanded again', () => {
    assert.equal(fmt('%s', '%s %d'), '%s %d');
  });
  it('when the pattern has hostile specifiers, then they stay literal and nothing is allocated for them', () => {
    assert.equal(fmt('%999999d', '1'), '%999999d');
    assert.equal(fmt('%n', '1'), '%n');
    assert.equal(fmt('%*d', '1'), '%*d');
    assert.equal(fmt('%-5s|%05d|%.3f|%x|%c', 'a'), '%-5s|%05d|%.3f|%x|%c');
    assert.equal(fmt('%99999999999999999999$s', 'a'), '%99999999999999999999$s');
  });
  it('when the pattern ends with a lone %, or with %1$ or %12, then the text is kept as is', () => {
    assert.equal(fmt('50%'), '50%');
    assert.equal(fmt('x %1$', 'a'), 'x %1$');
    assert.equal(fmt('x %12', 'a'), 'x %12');
    assert.equal(fmt('% s', 'a'), '% s');
  });
  it('when the pattern is empty, then the result is empty', () => {
    assert.equal(fmt(''), '');
  });
});
