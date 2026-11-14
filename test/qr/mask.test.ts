import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { maskPenalty, qrMatrix, qrMatrixWithMask } from '../../src/qr/qr.ts';
import { readMask } from './decoder.ts';

const grid = (n: number, dark: (r: number, c: number) => boolean) =>
  Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => dark(r, c)));

describe('given the penalty rules of ISO/IEC 18004 (N1..N4)', () => {
  it('when every module is dark (21x21) then 798 (runs) + 1200 (2x2 blocks) + 90 (balance) = 2088', () => {
    assert.equal(maskPenalty(grid(21, () => true)), 2088);
  });
  it('when every module is light (21x21) then the penalty is the same 2088', () => {
    assert.equal(maskPenalty(grid(21, () => false)), 2088);
  });
  it('when the grid is a checkerboard then the penalty is 0', () => {
    assert.equal(maskPenalty(grid(21, (r, c) => (r + c) % 2 === 0)), 0);
  });
  it('when rows alternate (21x21) then only N1 applies: 21 runs of 21 = 21 * 19 = 399', () => {
    assert.equal(maskPenalty(grid(21, (r) => r % 2 === 0)), 399);
  });
  it('when a 1:1:3:1:1 pattern has 4 light modules on both sides then N3 adds 2 * 40', () => {
    const dark = new Set([4, 6, 7, 8, 10]);
    // N1 362 + N2 540 + N3 80 + N4 90
    assert.equal(maskPenalty(grid(15, (r, c) => r === 7 && dark.has(c))), 1072);
  });
});

describe('given a text and the eight masks', () => {
  for (const text of ['http://192.168.1.20:5170/?t=abc123', 'hi', 'x'.repeat(62)]) {
    it(`when encoding "${text.slice(0, 18)}" then the chosen mask has the lowest penalty (first on ties)`, () => {
      const penalties = Array.from({ length: 8 }, (_, m) => maskPenalty(qrMatrixWithMask(text, m)));
      const best = penalties.indexOf(Math.min(...penalties));
      assert.equal(readMask(qrMatrix(text)), best);
      assert.deepEqual(qrMatrix(text), qrMatrixWithMask(text, best));
    });
  }
  it('when encoding the same text with different masks then the matrices differ', () => {
    assert.notDeepEqual(qrMatrixWithMask('hello', 0), qrMatrixWithMask('hello', 1));
  });
});
