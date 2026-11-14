import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cppString, objcString } from '../../src/generate/escape.ts';

describe('given text emitted as a C++ string literal', () => {
  it('when it has a quote and a backslash, then both are escaped', () => {
    assert.equal(cppString('say "hi" \\ bye'), '"say \\"hi\\" \\\\ bye"');
  });
});

describe('given text with whitespace control characters', () => {
  it('when it has a newline, a tab and a carriage return, then they become \\n, \\t and \\r', () => {
    assert.equal(cppString('a\nb\tc\rd'), '"a\\nb\\tc\\rd"');
  });
});

describe('given text with other control characters', () => {
  it('when it has U+0001 followed by a digit, then it becomes a 3-digit octal escape (never \\x, which is greedy)', () => {
    assert.equal(cppString('\u00011'), '"\\0011"');
  });

  it('when it has DEL (U+007F), then it becomes \\177', () => {
    assert.equal(cppString('\u007f'), '"\\177"');
  });
});

describe('given non-ASCII text', () => {
  it('when emitted as a C++ literal, then UTF-8 is kept verbatim', () => {
    assert.equal(cppString('Olá, 世界 🙂'), '"Olá, 世界 🙂"');
  });
});

describe('given text emitted as an Objective-C string literal', () => {
  it('when it has special characters, then it is the C++ literal prefixed with @', () => {
    assert.equal(objcString('a "b"\n'), '@"a \\"b\\"\\n"');
  });
});
