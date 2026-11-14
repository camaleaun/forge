import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildIcns, encodeIcns } from '../../src/icon/icns.ts';
import { rasterizeSvg } from '../../src/icon/raster.ts';
import { encodePng } from '../../src/dmg/png.ts';
import { decodePng, svgOf } from './helpers.ts';

interface Chunk { type: string; length: number; data: Buffer }
function readIcns(icns: Uint8Array): { magic: string; total: number; chunks: Chunk[] } {
  const buf = Buffer.from(icns);
  const chunks: Chunk[] = [];
  let pos = 8;
  while (pos < buf.length) {
    const length = buf.readUInt32BE(pos + 4);
    chunks.push({ type: buf.toString('latin1', pos, pos + 4), length, data: buf.subarray(pos + 8, pos + length) });
    pos += length;
  }
  assert.equal(pos, buf.length, 'chunks must tile the file exactly');
  return { magic: buf.toString('latin1', 0, 4), total: buf.readUInt32BE(4), chunks };
}

describe('given encodeIcns with two entries', () => {
  const a = new Uint8Array([1, 2, 3]);
  const b = new Uint8Array([9, 8, 7, 6, 5]);
  const out = encodeIcns([{ type: 'icp4', png: a }, { type: 'ic07', png: b }]);

  it('when encoded then the header is "icns" and a big-endian total length equal to the byte length', () => {
    assert.equal(Buffer.from(out).toString('latin1', 0, 4), 'icns');
    assert.equal(Buffer.from(out).readUInt32BE(4), out.length);
    assert.equal(out.length, 8 + (8 + 3) + (8 + 5));
  });

  it('when encoded then each chunk is type, length including its header, and the data, in order', () => {
    const { chunks } = readIcns(out);
    assert.deepEqual(chunks.map((c) => [c.type, c.length]), [['icp4', 11], ['ic07', 13]]);
    assert.deepEqual([...chunks[0].data], [1, 2, 3]);
    assert.deepEqual([...chunks[1].data], [9, 8, 7, 6, 5]);
  });

  it('when there are no entries then only the 8-byte header is written', () => {
    assert.deepEqual([...encodeIcns([])], [0x69, 0x63, 0x6e, 0x73, 0, 0, 0, 8]);
  });

  it('when a type is not four ASCII characters then it throws', () => {
    assert.throws(() => encodeIcns([{ type: 'abc', png: a }]), /icns type must be 4 ASCII characters: "abc"/);
    assert.throws(() => encodeIcns([{ type: 'abcdé', png: a }]), /icns type must be 4 ASCII characters/);
  });
});

describe('given buildIcns on a sample icon', () => {
  const svg = svgOf('<rect width="100" height="100" rx="22" fill="orange"/><circle cx="50" cy="50" r="20" fill="white"/>');
  const icns = buildIcns(svg);
  const parsed = readIcns(icns);
  const expected: [string, number][] = [
    ['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024],
    ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512],
  ];

  it('when built then the structure is valid: magic and length field', () => {
    assert.equal(parsed.magic, 'icns');
    assert.equal(parsed.total, icns.length);
  });

  it('when built then the chunk types are the eleven PNG-based types', () => {
    assert.deepEqual(parsed.chunks.map((c) => c.type), expected.map(([t]) => t));
  });

  it('when built then every chunk length covers its header and the data', () => {
    for (const c of parsed.chunks) assert.equal(c.length, c.data.length + 8);
  });

  it('when built then each chunk holds a valid PNG of the right pixel size', () => {
    for (const [type, size] of expected) {
      const chunk = parsed.chunks.find((c) => c.type === type)!;
      const png = decodePng(chunk.data);
      assert.deepEqual([type, png.width, png.height], [type, size, size]);
    }
  });

  it('when built then the PNG pixels equal a direct rasterization (center is white, corner transparent)', () => {
    const png = decodePng(parsed.chunks.find((c) => c.type === 'ic08')!.data);
    assert.deepEqual(png.rgba, rasterizeSvg(svg, 256));
    assert.deepEqual([...png.rgba.subarray((128 * 256 + 128) * 4, (128 * 256 + 128) * 4 + 4)], [255, 255, 255, 255]);
    assert.equal(png.rgba[3], 0);
  });

  it('when built then duplicate sizes share identical bytes (16@2x is the 32px render)', () => {
    const byType = (t: string) => parsed.chunks.find((c) => c.type === t)!.data;
    assert.ok(byType('icp5').equals(byType('ic11')));
    assert.ok(byType('icp6').equals(byType('ic12')));
    assert.ok(byType('ic08').equals(byType('ic13')));
    assert.ok(byType('ic09').equals(byType('ic14')));
  });

  it('when built then each distinct size is rendered exactly once', () => {
    const calls: number[] = [];
    buildIcns(svg, (source, size) => { calls.push(size); return rasterizeSvg(source, size); });
    assert.deepEqual(calls.toSorted((a, b) => a - b), [16, 32, 64, 128, 256, 512, 1024]);
  });

  it('when built twice then the bytes are identical', () => {
    assert.ok(Buffer.from(buildIcns(svg)).equals(Buffer.from(icns)));
  });

  it('when the svg is unsupported then the parse error propagates', () => {
    assert.throws(() => buildIcns('<svg viewBox="0 0 1 1"><text/></svg>'), /icon\.svg:1:24: unsupported element <text>/);
  });

  it('when the encoder is given the same PNG bytes it keeps them verbatim', () => {
    const png = encodePng(1, 1, new Uint8Array([1, 2, 3, 4]));
    const out = readIcns(encodeIcns([{ type: 'icp4', png }]));
    assert.deepEqual([...out.chunks[0].data], [...png]);
  });
});
