import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rsEncode, rsGenerator, gfMul } from '../../src/qr/reed-solomon.ts';

// Evaluate a polynomial (highest degree first) at x over GF(256).
function evalPoly(poly: number[], x: number): number {
  let r = 0;
  for (const c of poly) r = gfMul(r, x) ^ c;
  return r;
}

describe('given the ISO/IEC 18004 worked example (version 1-M, numeric "01234567")', () => {
  const data = [0x10, 0x20, 0x0c, 0x56, 0x61, 0x80, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11];
  it('when computing 10 EC codewords then they equal the published vector', () => {
    assert.deepEqual(rsEncode(data, 10), [0xa5, 0x24, 0xd4, 0xc1, 0xed, 0x36, 0xc7, 0x87, 0x2c, 0x55]);
  });
});

describe('given the generator polynomial of degree n', () => {
  it('when n = 2 then it is x^2 + 3x + 2 (roots a^0 and a^1)', () => {
    assert.deepEqual(rsGenerator(2), [1, 3, 2]);
  });
  it('when n = 10 then it is monic and has roots a^0..a^9', () => {
    const g = rsGenerator(10);
    assert.equal(g.length, 11);
    assert.equal(g[0], 1);
    let a = 1;
    for (let i = 0; i < 10; i++) {
      assert.equal(evalPoly(g, a), 0);
      a = gfMul(a, 2);
    }
  });
});

describe('given arbitrary data and EC lengths', () => {
  for (const ec of [10, 16, 18, 24, 26]) {
    it(`when appending ${ec} EC codewords then the codeword polynomial is divisible by the generator`, () => {
      const data = Array.from({ length: 30 }, (_, i) => (i * 37 + 11) & 0xff);
      const codeword = [...data, ...rsEncode(data, ec)];
      const g = rsGenerator(ec);
      let a = 1;
      for (let i = 0; i < ec; i++) {
        assert.equal(evalPoly(codeword, a), 0);
        a = gfMul(a, 2);
      }
      assert.equal(g.length, ec + 1);
    });
  }
});

describe('given GF(256) multiplication', () => {
  it('when multiplying then it follows the 0x11D field', () => {
    assert.equal(gfMul(0x80, 2), 0x1d);
    assert.equal(gfMul(0, 77), 0);
    assert.equal(gfMul(1, 77), 77);
  });
});
