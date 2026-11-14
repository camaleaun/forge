import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { scanBalanced } from '../../src/tsx/scan.ts';

// Returns the index of the "}" that closes the "{" at index 0.
const close = (code: string) => scanBalanced(code, 0, 'App.tsx');

describe('given a balanced scanner', () => {
  it('when the braces are plain, then it returns the matching close index', () => {
    assert.equal(close('{a}'), 2);
    assert.equal(close('{ {a: {b}} } tail'), 11);
  });

  it('when a "}" is inside a string, then it is skipped', () => {
    assert.equal(close(`{go('}')}`), 8);
    assert.equal(close('{go("}")}'), 8);
    assert.equal(close(`{'it\\'s }'}`), 10);
  });

  it('when a "}" is inside a template literal, then it is skipped and ${} nests', () => {
    assert.equal(close('{`a}${ {x:`}`}.x }b`}'), 20);
  });

  it('when a "}" is inside a comment, then it is skipped', () => {
    assert.equal(close('{a /* } */ + b // }\n}'), 20);
  });

  it('when a "}" is inside a regex literal, then it is skipped; division is not a regex', () => {
    assert.equal(close('{x.replace(/}/g, "")}'), 20);
    assert.equal(close('{a / b / c}'), 10);
    assert.equal(close('{[/[}]/]}'), 8);
  });

  it('when the "{" is never closed, then it throws file:L:C: with the position of the "{"', () => {
    assert.throws(() => scanBalanced('x\n  {a', 4, 'App.tsx'), /^Error: App\.tsx:2:3: unbalanced "\{"/);
  });

  it('when a string is never closed, then it throws at the string start', () => {
    assert.throws(() => close(`{'abc}`), /^Error: App\.tsx:1:2: unterminated string/);
  });
});
