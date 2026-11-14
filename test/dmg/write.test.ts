import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeDmgBackground } from '../../src/dmg/write.ts';

describe('given an empty output directory', () => {
  let dir = '';
  let paths = { png1x: '', png2x: '' };
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'forge-dmg-'));
    paths = writeDmgBackground(dir);
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('when written then paths are background.png and background@2x.png in that dir', () => {
    assert.equal(paths.png1x, join(dir, 'background.png'));
    assert.equal(paths.png2x, join(dir, 'background@2x.png'));
  });

  it('when written then both files are PNGs of 600x400 and 1200x800', () => {
    for (const [file, w, h] of [[paths.png1x, 600, 400], [paths.png2x, 1200, 800]] as const) {
      const buf = readFileSync(file);
      assert.equal(buf.toString('latin1', 1, 4), 'PNG');
      assert.equal(buf.readUInt32BE(16), w);
      assert.equal(buf.readUInt32BE(20), h);
    }
  });

  it('when written then the 2x PNG is under 40 KB', () => {
    const size = statSync(paths.png2x).size;
    assert.ok(size < 40 * 1024, `size ${size}`);
  });
});
