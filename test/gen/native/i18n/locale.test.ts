import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildDriver, hasClang, VECTORS } from './helper.ts';
import type { Driver } from './helper.ts';

const vectors = JSON.parse(readFileSync(VECTORS, 'utf8'));
let d: Driver;

describe('given the C++ locale functions and the shared vectors', { skip: !hasClang && 'clang++ not installed' }, () => {
  before(() => { d = buildDriver(); });
  after(() => d.dispose());

  for (const [raw, expected] of vectors.normalizeTag as [string, string | null][]) {
    it(`when normalizing ${JSON.stringify(raw)}, then the tag is ${JSON.stringify(expected)}`, () => {
      assert.equal(d.run('normalize', raw), `[${expected ?? ''}]\n`);
    });
  }

  for (const c of vectors.pickLocale as { preferred: string[]; available: string[]; expected: string }[]) {
    it(`when the user prefers [${c.preferred}] and the packs are [${c.available}], then the pick is ${c.expected}`, () => {
      assert.equal(d.run('pick', c.preferred.join(','), c.available.join(',')), `[${c.expected}]\n`);
    });
  }

  it('when a preferred tag is a POSIX locale with an encoding, then it is normalized before matching', () => {
    assert.equal(d.run('pick', 'pt_BR.UTF-8', 'pt-BR'), '[pt-BR]\n');
  });
  it('when the first preferred entry is undefined (C), then it is skipped', () => {
    assert.equal(d.run('pick', 'C,pt-BR', 'pt-BR'), '[pt-BR]\n');
  });
  it('when the tag holds characters outside letters, digits and dashes, then it is undefined', () => {
    assert.equal(d.run('normalize', 'pt BR/../x'), '[]\n');
  });
});
