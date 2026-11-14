import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { qrMatrix, formatBits } from '../../src/qr/qr.ts';
import { ALIGN_CENTER, FORMAT_M, readFormatCopy1, readFormatCopy2, versionOf } from './decoder.ts';

const URL = 'http://192.168.1.20:5170/?t=abc123';
const sizeOfLength = (len: number) => qrMatrix('a'.repeat(len)).length;

describe('given the format information for error correction level M', () => {
  it('when asking for each mask then the BCH(15,5) value xor 0x5412 equals the standard table', () => {
    for (let mask = 0; mask < 8; mask++) assert.equal(formatBits(mask), FORMAT_M[mask], `mask ${mask}`);
    assert.equal(formatBits(0), 0x5412);
  });
});

describe('given the version selection', () => {
  it('when the text has 14 bytes then version 1 (21x21) is used', () => assert.equal(sizeOfLength(14), 21));
  it('when the text has 15 bytes then version 2 (25x25) is used', () => assert.equal(sizeOfLength(15), 25));
  it('when the text has 26 bytes then version 2 is used', () => assert.equal(sizeOfLength(26), 25));
  it('when the text has 27 bytes then version 3 (29x29) is used', () => assert.equal(sizeOfLength(27), 29));
  it('when the text has 42, 62, 84 bytes then versions 3, 4, 5 are used', () => {
    assert.equal(sizeOfLength(42), 29);
    assert.equal(sizeOfLength(43), 33);
    assert.equal(sizeOfLength(62), 33);
    assert.equal(sizeOfLength(63), 37);
    assert.equal(sizeOfLength(84), 37);
    assert.equal(sizeOfLength(85), 41);
  });
  it('when the text has 106 bytes then version 6 (41x41) is used', () => assert.equal(sizeOfLength(106), 41));
  it('when counting length then bytes (UTF-8) count, not characters', () => {
    assert.equal(qrMatrix('é'.repeat(8)).length, 25); // 16 bytes > 14
  });
  it('when the text needs more than version 6 then it throws a clear error', () => {
    assert.throws(() => qrMatrix('a'.repeat(107)), /does not fit.*107 bytes.*106/);
  });
});

for (const text of ['hi', URL, 'a'.repeat(100)]) {
  describe(`given the QR for "${text.slice(0, 20)}" (${text.length} chars)`, () => {
    const m = qrMatrix(text);
    const n = m.length;
    const v = versionOf(m);
    const at = (r: number, c: number) => m[r][c];

    it('when inspecting its shape then it is square with size 21+4*(v-1)', () => {
      assert.equal(n, 21 + 4 * (v - 1));
      for (const row of m) assert.equal(row.length, n);
    });

    it('when inspecting the corners then three finder patterns are exact', () => {
      for (const [r0, c0] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
        for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) {
          const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3)); // 0..3
          const dark = ring !== 2;
          assert.equal(at(r0 + r, c0 + c), dark, `finder at ${r0},${c0} cell ${r},${c}`);
        }
      }
    });

    it('when inspecting beside the finders then separators are light', () => {
      for (let i = 0; i < 8; i++) {
        assert.equal(at(7, i), false); assert.equal(at(i, 7), false);
        assert.equal(at(7, n - 1 - i), false); assert.equal(at(i, n - 8), false);
        assert.equal(at(n - 8, i), false); assert.equal(at(n - 1 - i, 7), false);
      }
    });

    it('when inspecting row 6 and column 6 then timing patterns alternate starting dark', () => {
      for (let i = 8; i < n - 8; i++) {
        assert.equal(at(6, i), i % 2 === 0, `row 6 col ${i}`);
        assert.equal(at(i, 6), i % 2 === 0, `col 6 row ${i}`);
      }
    });

    it('when inspecting the lower left then the dark module sits at row 4v+9, col 8', () => {
      assert.equal(at(4 * v + 9, 8), true);
    });

    it('when version >= 2 then a 5x5 alignment pattern is centred as in the standard', () => {
      const a = ALIGN_CENTER[v];
      if (v < 2) return assert.equal(a, undefined);
      for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++) {
        const dark = Math.max(Math.abs(r), Math.abs(c)) !== 1;
        assert.equal(at(a + r, a + c), dark, `alignment cell ${r},${c}`);
      }
    });

    it('when reading the format info then both copies are identical and in the M table', () => {
      const f1 = readFormatCopy1(m);
      assert.equal(readFormatCopy2(m), f1);
      assert.ok(FORMAT_M.includes(f1), `format ${f1.toString(2)} is a valid M format`);
    });
  });
}
