// Apple .icns writer (PNG-based icon types, macOS 10.7+).

import { encodePng } from '../dmg/png.ts';
import { rasterizeSvg } from './raster.ts';
import { parseSvg } from './svg.ts';
import type { SvgDocument } from './svg.ts';

export interface IcnsEntry { type: string; png: Uint8Array }

export function encodeIcns(entries: IcnsEntry[]): Uint8Array {
  for (const { type } of entries) {
    if (!/^[\x20-\x7e]{4}$/.test(type)) throw new Error(`icns type must be 4 ASCII characters: "${type}"`);
  }
  const total = 8 + entries.reduce((sum, e) => sum + 8 + e.png.length, 0);
  const out = Buffer.alloc(total);
  out.write('icns', 0, 'latin1');
  out.writeUInt32BE(total, 4);
  let pos = 8;
  for (const { type, png } of entries) {
    out.write(type, pos, 'latin1');
    out.writeUInt32BE(8 + png.length, pos + 4);
    out.set(png, pos + 8);
    pos += 8 + png.length;
  }
  return new Uint8Array(out);
}

// Chunk type -> pixel size. The @2x types reuse the pixel size of the next point size.
const ICNS_TYPES: [string, number][] = [
  ['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024],
  ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512],
];

export type Renderer = (svg: SvgDocument, size: number) => Uint8Array;

/** Rasterizes the SVG once per distinct size and writes all PNG-based icns types. */
export function buildIcns(svg: string, render: Renderer = rasterizeSvg): Uint8Array {
  const doc = parseSvg(svg);
  const pngs = new Map<number, Uint8Array>();
  for (const [, size] of ICNS_TYPES) {
    if (!pngs.has(size)) pngs.set(size, encodePng(size, size, render(doc, size)));
  }
  return encodeIcns(ICNS_TYPES.map(([type, size]) => ({ type, png: pngs.get(size)! })));
}
