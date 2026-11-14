import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeIconAssets } from '../../src/icon/write.ts';
import { buildIcns } from '../../src/icon/icns.ts';
import { rasterizeSvg } from '../../src/icon/raster.ts';
import { decodePng, svgOf } from './helpers.ts';

const svg = svgOf('<rect width="100" height="100" rx="20" fill="orange"/><circle cx="50" cy="50" r="25" fill="white" stroke="#333" stroke-width="2"/>');
const tmp = mkdtempSync(join(tmpdir(), 'forge-icon-'));
after(() => rmSync(tmp, { recursive: true, force: true }));

describe('given an svg and an output directory', () => {
  it('when writing with defaults then AppIcon.icns, AppIcon-512.png and AppIcon-32.png are created and returned', () => {
    const dir = join(tmp, 'defaults');
    const out = writeIconAssets(svg, dir);
    assert.deepEqual(out, { icns: join(dir, 'AppIcon.icns'), png512: join(dir, 'AppIcon-512.png'), favicon32: join(dir, 'AppIcon-32.png') });
    assert.deepEqual(readdirSync(dir).sort(), ['AppIcon-32.png', 'AppIcon-512.png', 'AppIcon.icns']);
  });

  it('when a name is given then it prefixes all three files', () => {
    const dir = join(tmp, 'named');
    const out = writeIconAssets(svg, dir, { name: 'Logo' });
    assert.deepEqual(readdirSync(dir).sort(), ['Logo-32.png', 'Logo-512.png', 'Logo.icns']);
    assert.equal(out.icns, join(dir, 'Logo.icns'));
  });

  it('when the directory does not exist then it is created, including parents', () => {
    const dir = join(tmp, 'a', 'b', 'c');
    writeIconAssets(svg, dir);
    assert.ok(existsSync(join(dir, 'AppIcon.icns')));
  });

  it('when written then the PNGs are valid and match direct rasterization', () => {
    const dir = join(tmp, 'pngs');
    const out = writeIconAssets(svg, dir);
    const big = decodePng(readFileSync(out.png512));
    const small = decodePng(readFileSync(out.favicon32));
    assert.deepEqual([big.width, big.height, small.width, small.height], [512, 512, 32, 32]);
    assert.deepEqual(big.rgba, rasterizeSvg(svg, 512));
    assert.deepEqual(small.rgba, rasterizeSvg(svg, 32));
  });

  it('when written then the icns file equals buildIcns output', () => {
    const out = writeIconAssets(svg, join(tmp, 'icns'));
    assert.ok(readFileSync(out.icns).equals(Buffer.from(buildIcns(svg))));
  });

  it('when the svg is invalid then nothing is written', () => {
    const dir = join(tmp, 'invalid');
    assert.throws(() => writeIconAssets('<svg viewBox="0 0 1 1"><text/></svg>', dir), /unsupported element <text>/);
    assert.equal(existsSync(dir), false);
  });
});

function hasIconutil(): boolean {
  if (process.platform !== 'darwin') return false;
  try { execFileSync('which', ['iconutil'], { stdio: 'ignore' }); return true; } catch { return false; }
}

describe('given macOS iconutil', { skip: !hasIconutil() && 'requires darwin with iconutil' }, () => {
  it('when converting the written icns to an iconset then all ten files exist with the expected pixel sizes', () => {
    const dir = join(tmp, 'roundtrip');
    const { icns } = writeIconAssets(svg, dir);
    const iconset = join(tmp, 'roundtrip.iconset');
    execFileSync('iconutil', ['--convert', 'iconset', icns, '-o', iconset]);
    const expected: Record<string, number> = {
      'icon_16x16.png': 16, 'icon_16x16@2x.png': 32, 'icon_32x32.png': 32, 'icon_32x32@2x.png': 64,
      'icon_128x128.png': 128, 'icon_128x128@2x.png': 256, 'icon_256x256.png': 256, 'icon_256x256@2x.png': 512,
      'icon_512x512.png': 512, 'icon_512x512@2x.png': 1024,
    };
    const files = readdirSync(iconset);
    for (const [name, px] of Object.entries(expected)) {
      assert.ok(files.includes(name), `${name} missing from ${files.join(', ')}`);
      const sips = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', join(iconset, name)], { encoding: 'utf8' });
      assert.match(sips, new RegExp(`pixelWidth: ${px}\\b`), name);
      assert.match(sips, new RegExp(`pixelHeight: ${px}\\b`), name);
    }
  });

  it('when iconutil converts an iconset back to icns from our PNGs then it accepts them (sanity of the PNG encoder)', () => {
    const iconset = join(tmp, 'sanity.iconset');
    execFileSync('mkdir', ['-p', iconset]);
    const dir = join(tmp, 'sanity');
    const { png512 } = writeIconAssets(svg, dir);
    writeFileSync(join(iconset, 'icon_512x512.png'), readFileSync(png512));
    execFileSync('iconutil', ['--convert', 'icns', iconset, '-o', join(tmp, 'sanity.icns')]);
    assert.ok(existsSync(join(tmp, 'sanity.icns')));
  });
});
