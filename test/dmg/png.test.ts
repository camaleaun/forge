import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { crc32, inflateSync } from 'node:zlib';
import { encodePng } from '../../src/dmg/png.ts';

interface Chunk { type: string; data: Buffer; crc: number }

function readChunks(png: Uint8Array): Chunk[] {
  const buf = Buffer.from(png);
  const chunks: Chunk[] = [];
  let pos = 8;
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    const crc = buf.readUInt32BE(pos + 8 + len);
    chunks.push({ type, data, crc });
    pos += 12 + len;
  }
  return chunks;
}

function samplePixels(w: number, h: number): Uint8Array {
  const px = new Uint8Array(w * h * 4);
  for (let i = 0; i < px.length; i++) px[i] = (i * 37 + 11) & 255;
  return px;
}

describe('given a 3x2 RGBA image', () => {
  const w = 3, h = 2;
  const png = encodePng(w, h, samplePixels(w, h));

  it('when encoded then it starts with the PNG signature', () => {
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  });

  it('when encoded then IHDR holds size, 8-bit depth and RGBA color type', () => {
    const ihdr = readChunks(png)[0];
    assert.equal(ihdr.type, 'IHDR');
    assert.equal(ihdr.data.readUInt32BE(0), w);
    assert.equal(ihdr.data.readUInt32BE(4), h);
    assert.equal(ihdr.data[8], 8);
    assert.equal(ihdr.data[9], 6);
  });

  it('when encoded then chunks are IHDR, IDAT, IEND with valid CRCs', () => {
    const chunks = readChunks(png);
    assert.deepEqual(chunks.map((c) => c.type), ['IHDR', 'IDAT', 'IEND']);
    for (const c of chunks) {
      const expected = crc32(Buffer.concat([Buffer.from(c.type, 'latin1'), c.data]));
      assert.equal(c.crc, expected);
    }
  });

  it('when IDAT is inflated then pixels round trip (filter 0)', () => {
    const src = samplePixels(w, h);
    const raw = inflateSync(readChunks(png)[1].data);
    assert.equal(raw.length, h * (1 + w * 4));
    for (let y = 0; y < h; y++) {
      const row = y * (1 + w * 4);
      assert.equal(raw[row], 0);
      assert.deepEqual([...raw.subarray(row + 1, row + 1 + w * 4)], [...src.subarray(y * w * 4, (y + 1) * w * 4)]);
    }
  });
});
