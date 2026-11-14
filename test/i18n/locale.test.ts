import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeTag, pickLocale } from '../../src/i18n/locale.ts';

const vectors = JSON.parse(readFileSync(new URL('../fixtures/i18n/vectors.json', import.meta.url), 'utf8'));

describe('given a raw locale string', () => {
  for (const [raw, expected] of vectors.normalizeTag) {
    it(`when normalizing ${JSON.stringify(raw)} then the tag is ${JSON.stringify(expected)}`, () => {
      assert.equal(normalizeTag(raw), expected ?? undefined);
    });
  }
  it('when it has surrounding whitespace then it is trimmed', () => {
    assert.equal(normalizeTag('  pt_BR  '), 'pt-BR');
  });
  it('when it is hostile (garbage characters, very long) then it is undefined', () => {
    assert.equal(normalizeTag('../../etc'), undefined);
    assert.equal(normalizeTag('pt\0BR'), undefined);
    assert.equal(normalizeTag('a'.repeat(500)), undefined);
    assert.equal(normalizeTag('123'), undefined);
  });
});

describe('given the available packs', () => {
  for (const c of vectors.pickLocale) {
    it(`when the user prefers ${JSON.stringify(c.preferred)} and ${JSON.stringify(c.available)} exist then ${c.expected} is picked`, () => {
      assert.equal(pickLocale(c.preferred, c.available), c.expected);
    });
  }
  it('when a preferred tag is unnormalized then it still matches', () => {
    assert.equal(pickLocale(['pt_PT.UTF-8'], ['pt-BR']), 'pt-BR');
  });
  it('when the preferred tag matches exactly among several packs then the exact one wins', () => {
    assert.equal(pickLocale(['pt-PT'], ['pt-BR', 'pt-PT']), 'pt-PT');
  });
});
