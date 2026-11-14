// QR Code Model 2 encoder: byte mode (UTF-8), error correction level M, versions 1..6.
import { rsEncode } from './reed-solomon.ts';

// Per version at level M: [blocks, data codewords per block, EC codewords per block].
const BLOCKS_M: Array<[number, number, number]> = [
  [1, 16, 10], [1, 28, 16], [1, 44, 26], [2, 32, 18], [2, 43, 24], [4, 27, 16],
];
// Centre of the single alignment pattern for versions 2..6 (version 1 has none).
const ALIGNMENT_CENTER = [0, 18, 22, 26, 30, 34];

const MASKS: Array<(r: number, c: number) => boolean> = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/** 15-bit format information for level M (indicator 00) and the given mask, BCH(15,5) xor 0x5412. */
export function formatBits(mask: number): number {
  const data = mask; // (00 << 3) | mask
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

// Rule N3 pattern: dark-light-dark x3-light-dark (1:1:3:1:1).
const FINDER_LIKE = [true, false, true, true, true, false, true];

function lineRuns(line: boolean[]): number {
  let score = 0;
  let run = 1;
  for (let i = 1; i <= line.length; i++) {
    if (i < line.length && line[i] === line[i - 1]) {
      run++;
      continue;
    }
    if (run >= 5) score += 3 + (run - 5); // N1
    run = 1;
  }
  return score;
}

function lineFinderLike(line: boolean[]): number {
  let score = 0;
  for (let i = 0; i + 7 <= line.length; i++) {
    if (!FINDER_LIKE.every((d, k) => line[i + k] === d)) continue;
    const light = (from: number, to: number) => {
      if (from < 0 || to > line.length) return false; // border: not enough room for 4 modules
      for (let k = from; k < to; k++) if (line[k]) return false;
      return true;
    };
    if (light(i - 4, i)) score += 40; // N3, light side before
    if (light(i + 7, i + 11)) score += 40; // N3, light side after
  }
  return score;
}

/** Total penalty of ISO/IEC 18004 section 7.8.3 (rules N1 to N4); lower is better. */
export function maskPenalty(matrix: boolean[][]): number {
  const n = matrix.length;
  let score = 0;
  for (let i = 0; i < n; i++) {
    const row = matrix[i];
    const col = matrix.map((r) => r[i]);
    score += lineRuns(row) + lineRuns(col) + lineFinderLike(row) + lineFinderLike(col);
  }
  let dark = 0;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (matrix[r][c]) dark++;
      if (r + 1 < n && c + 1 < n) {
        const v = matrix[r][c];
        if (v === matrix[r][c + 1] && v === matrix[r + 1][c] && v === matrix[r + 1][c + 1]) score += 3; // N2
      }
    }
  }
  const total = n * n;
  score += 10 * (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1); // N4
  return score;
}

function capacityBytes(version: number): number {
  const [blocks, data] = BLOCKS_M[version - 1];
  return blocks * data - 2; // 4-bit mode + 8-bit count indicator = 12 bits; the 4-bit terminator is optional, so 2 bytes of overhead
}

function chooseVersion(length: number): number {
  for (let v = 1; v <= BLOCKS_M.length; v++) if (length <= capacityBytes(v)) return v;
  throw new Error(
    `QR text does not fit: ${length} bytes, maximum is ${capacityBytes(BLOCKS_M.length)} bytes (version ${BLOCKS_M.length}, level M)`,
  );
}

function dataCodewords(bytes: Uint8Array, version: number): number[] {
  const capacity = BLOCKS_M[version - 1][0] * BLOCKS_M[version - 1][1];
  const bits: number[] = [];
  const push = (value: number, count: number) => {
    for (let i = count - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, 8);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, capacity * 8 - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  for (let pad = 0xec; out.length < capacity; pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}

function interleave(data: number[], version: number): number[] {
  const [blocks, dataLen, ecLen] = BLOCKS_M[version - 1];
  const dataBlocks: number[][] = [];
  const ecBlocks: number[][] = [];
  for (let b = 0; b < blocks; b++) {
    const block = data.slice(b * dataLen, (b + 1) * dataLen);
    dataBlocks.push(block);
    ecBlocks.push(rsEncode(block, ecLen));
  }
  const out: number[] = [];
  for (let i = 0; i < dataLen; i++) for (const block of dataBlocks) out.push(block[i]);
  for (let i = 0; i < ecLen; i++) for (const block of ecBlocks) out.push(block[i]);
  return out;
}

interface Grid {
  modules: boolean[][];
  isFunction: boolean[][];
}

function drawFunctionPatterns(version: number): Grid {
  const size = 17 + 4 * version;
  const modules = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const isFunction = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const set = (r: number, c: number, dark: boolean) => {
    if (r < 0 || c < 0 || r >= size || c >= size) return;
    modules[r][c] = dark;
    isFunction[r][c] = true;
  };
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  // Finder patterns with their light separators (the 9x9 areas also reserve the format info).
  for (const [r0, c0] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const ring = Math.max(Math.abs(dr - 3), Math.abs(dc - 3));
        set(r0 + dr, c0 + dc, ring !== 2 && ring !== 4);
      }
    }
  }
  const a = ALIGNMENT_CENTER[version - 1];
  if (a) {
    for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
      set(a + dr, a + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
    }
  }
  // Reserve the format areas (filled by drawFormat) and the dark module.
  for (let i = 0; i < 9; i++) {
    isFunction[8][i] = true;
    isFunction[i][8] = true;
  }
  for (let i = 0; i < 8; i++) {
    isFunction[8][size - 1 - i] = true;
    isFunction[size - 1 - i][8] = true;
  }
  set(size - 8, 8, true);
  return { modules, isFunction };
}

function drawFormat(grid: Grid, mask: number): void {
  const size = grid.modules.length;
  const bits = formatBits(mask);
  const bit = (i: number) => ((bits >>> i) & 1) === 1;
  const m = grid.modules;
  for (let i = 0; i <= 5; i++) m[i][8] = bit(i);
  m[7][8] = bit(6);
  m[8][8] = bit(7);
  m[8][7] = bit(8);
  for (let i = 9; i < 15; i++) m[8][14 - i] = bit(i);
  for (let i = 0; i < 8; i++) m[8][size - 1 - i] = bit(i);
  for (let i = 8; i < 15; i++) m[size - 15 + i][8] = bit(i);
}

function placeData(grid: Grid, codewords: number[], mask: number): void {
  const size = grid.modules.length;
  const maskFn = MASKS[mask];
  let k = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // skip the vertical timing column
    for (let i = 0; i < size; i++) {
      const r = upward ? size - 1 - i : i;
      for (let j = 0; j < 2; j++) {
        const c = right - j;
        if (grid.isFunction[r][c]) continue;
        const bit = k < codewords.length * 8 ? ((codewords[k >>> 3] >>> (7 - (k & 7))) & 1) === 1 : false;
        k++;
        grid.modules[r][c] = bit !== maskFn(r, c);
      }
    }
    upward = !upward;
  }
}

function build(text: string, mask: number): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  const version = chooseVersion(bytes.length);
  const codewords = interleave(dataCodewords(bytes, version), version);
  const grid = drawFunctionPatterns(version);
  placeData(grid, codewords, mask);
  drawFormat(grid, mask);
  return grid.modules;
}

export function qrMatrixWithMask(text: string, mask: number): boolean[][] {
  return build(text, mask);
}

/** Matrix of dark modules (true = dark), quiet zone not included, mask chosen by lowest penalty. */
export function qrMatrix(text: string): boolean[][] {
  let best: boolean[][] = [];
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const candidate = build(text, mask);
    const score = maskPenalty(candidate);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}
