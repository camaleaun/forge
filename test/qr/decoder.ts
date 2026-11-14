// Test-only QR reader: independent of the encoder (own function-pattern map and block table).
import { gfMul } from '../../src/qr/reed-solomon.ts';

// Format info for EC level M, masks 0..7 (ISO/IEC 18004 table C.1), 15 bits.
export const FORMAT_M = [
  0b101010000010010, 0b101000100100101, 0b101111001111100, 0b101101101001011,
  0b100010111111001, 0b100000011001110, 0b100111110010111, 0b100101010100000,
];
// version -> [blocks, data codewords per block, ec codewords per block] at level M
export const BLOCKS_M: Record<number, [number, number, number]> = {
  1: [1, 16, 10], 2: [1, 28, 16], 3: [1, 44, 26], 4: [2, 32, 18], 5: [2, 43, 24], 6: [4, 27, 16],
};
export const ALIGN_CENTER: Record<number, number> = { 2: 18, 3: 22, 4: 26, 5: 30, 6: 34 };

export function versionOf(m: boolean[][]): number {
  return (m.length - 17) / 4;
}

// Format bit i (0 = LSB) of the first copy, around the top-left finder.
export function readFormatCopy1(m: boolean[][]): number {
  const pos: Array<[number, number]> = []; // [row, col] for bit 0..14
  for (let i = 0; i <= 5; i++) pos.push([i, 8]);
  pos.push([7, 8], [8, 8], [8, 7]);
  for (let i = 9; i < 15; i++) pos.push([8, 14 - i]);
  return pos.reduce((acc, [r, c], i) => acc | ((m[r][c] ? 1 : 0) << i), 0);
}

// Second copy: bits 0..7 along row 8 from the right edge, bits 8..14 down column 8 at the bottom.
export function readFormatCopy2(m: boolean[][]): number {
  const n = m.length;
  let v = 0;
  for (let i = 0; i < 8; i++) v |= (m[8][n - 1 - i] ? 1 : 0) << i;
  for (let i = 8; i < 15; i++) v |= (m[n - 15 + i][8] ? 1 : 0) << i;
  return v;
}

export function isFunction(version: number, r: number, c: number): boolean {
  const n = 17 + 4 * version;
  if (r <= 8 && c <= 8) return true;
  if (r <= 8 && c >= n - 8) return true;
  if (r >= n - 8 && c <= 8) return true;
  if (r === 6 || c === 6) return true;
  const a = ALIGN_CENTER[version];
  if (a !== undefined && Math.abs(r - a) <= 2 && Math.abs(c - a) <= 2) return true;
  return false;
}

const MASKS: Array<(r: number, c: number) => boolean> = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => ((((r + c) % 2) + ((r * c) % 3)) % 2) === 0,
];

export function readMask(m: boolean[][]): number {
  const f = readFormatCopy1(m);
  const mask = FORMAT_M.indexOf(f);
  if (mask < 0) throw new Error(`unknown format info ${f.toString(2)}`);
  return mask;
}

export function readCodewords(m: boolean[][]): number[] {
  const n = m.length;
  const v = versionOf(m);
  const mask = MASKS[readMask(m)];
  const bits: number[] = [];
  let upward = true;
  for (let right = n - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let i = 0; i < n; i++) {
      const r = upward ? n - 1 - i : i;
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        if (isFunction(v, r, c)) continue;
        bits.push((m[r][c] !== mask(r, c)) ? 1 : 0);
      }
    }
    upward = !upward;
  }
  const out: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  return out;
}

// De-interleave, check every block against the RS generator, return the data codewords in order.
export function dataCodewords(m: boolean[][]): number[] {
  const v = versionOf(m);
  const [blocks, dataLen, ecLen] = BLOCKS_M[v];
  const cw = readCodewords(m);
  const total = blocks * (dataLen + ecLen);
  const data: number[][] = Array.from({ length: blocks }, () => []);
  const ec: number[][] = Array.from({ length: blocks }, () => []);
  let k = 0;
  for (let i = 0; i < dataLen; i++) for (let b = 0; b < blocks; b++) data[b].push(cw[k++]);
  for (let i = 0; i < ecLen; i++) for (let b = 0; b < blocks; b++) ec[b].push(cw[k++]);
  if (k !== total) throw new Error('codeword count mismatch');
  for (let b = 0; b < blocks; b++) {
    const word = [...data[b], ...ec[b]];
    let a = 1;
    for (let i = 0; i < ecLen; i++) {
      let r = 0;
      for (const c of word) r = gfMul(r, a) ^ c;
      if (r !== 0) throw new Error(`block ${b} fails the Reed-Solomon check`);
      a = gfMul(a, 2);
    }
  }
  return data.flat();
}

export function decode(m: boolean[][]): string {
  const cw = dataCodewords(m);
  const bits = cw.map((b) => b.toString(2).padStart(8, '0')).join('');
  if (bits.slice(0, 4) !== '0100') throw new Error('not byte mode');
  const len = parseInt(bits.slice(4, 12), 2);
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = parseInt(bits.slice(12 + 8 * i, 20 + 8 * i), 2);
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
