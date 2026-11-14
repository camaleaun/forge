import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatPrintf } from '../../src/i18n/format.ts';

describe('given a PHP/WordPress style pattern', () => {
  it('when it has %s and %d, then the arguments fill them in order', () => {
    assert.equal(formatPrintf('Hello, %s! You have %d files.', ['world', 3]), 'Hello, world! You have 3 files.');
  });

  it('when it has positional placeholders, then they pick the argument by number (translators may reorder)', () => {
    assert.equal(formatPrintf('%2$s, %1$s!', ['mundo', 'Olá']), 'Olá, mundo!');
  });

  it('when it has %%, then it prints a percent sign without consuming an argument', () => {
    assert.equal(formatPrintf('100%% of %s', ['all']), '100% of all');
  });

  it('when %d gets a numeric string, then it is printed as an integer', () => {
    assert.equal(formatPrintf('%d items', ['42']), '42 items');
  });
});

describe('given a pattern that does not match its arguments', () => {
  it('when there are too few arguments, then the specifier is left as it is (never a crash)', () => {
    assert.equal(formatPrintf('%s and %s', ['one']), 'one and %s');
  });

  it('when there are extra arguments, then they are ignored', () => {
    assert.equal(formatPrintf('%s', ['a', 'b']), 'a');
  });

  it('when the specifier is hostile (%999999d, %n, a lone %), then the text is kept and nothing explodes', () => {
    assert.equal(formatPrintf('%n 100% %999999d', [5]), '%n 100% %999999d');
  });
});
