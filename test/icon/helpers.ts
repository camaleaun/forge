import { inflateSync } from 'node:zlib';

export type Pixel = [number, number, number, number];

export function pixel(rgba: Uint8Array, size: number, x: number, y: number): Pixel {
  const i = (y * size + x) * 4;
  return [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]];
}

export function svgOf(body: string, viewBox = '0 0 100 100'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}</svg>`;
}

/** Decodes an 8-bit RGBA, filter-0 PNG as produced by encodePng; throws if it is not one. */
export function decodePng(png: Uint8Array): { width: number; height: number; rgba: Uint8Array } {
  const buf = Buffer.from(png);
  if (!buf.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('not a PNG');
  const width = buf.readUInt32BE(16), height = buf.readUInt32BE(20);
  let pos = 8;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    if (type === 'IDAT') idat.push(buf.subarray(pos + 8, pos + 8 + len));
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) rgba.set(raw.subarray(y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1)), y * width * 4);
  return { width, height, rgba };
}

export function near(actual: number, expected: number, eps: number, msg = ''): void {
  if (Math.abs(actual - expected) > eps) throw new Error(`${msg} expected ${expected} ± ${eps}, got ${actual}`);
}
