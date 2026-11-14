import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderDmgBackground } from '../../src/dmg/background.ts';
import { DMG_ICON_CENTERS, DMG_WINDOW } from '../../src/dmg/layout.ts';

type Img = ReturnType<typeof renderDmgBackground>;

function px(img: Img, x: number, y: number): number[] {
  const i = (y * img.width + x) * 4;
  return [...img.rgba.subarray(i, i + 4)];
}

describe('given the DMG background renderer', () => {
  it('when scale is 1 then the image is 600x400 pixels', () => {
    const img = renderDmgBackground({ scale: 1 });
    assert.equal(img.width, 600);
    assert.equal(img.height, 400);
    assert.equal(img.rgba.length, 600 * 400 * 4);
  });

  it('when scale is 2 (or omitted) then the image is 1200x800 pixels', () => {
    for (const img of [renderDmgBackground({ scale: 2 }), renderDmgBackground({})]) {
      assert.equal(img.width, 1200);
      assert.equal(img.height, 800);
      assert.equal(img.rgba.length, 1200 * 800 * 4);
    }
  });

  it('when rendered then icon centers are in points, independent of scale', () => {
    for (const scale of [1, 2] as const) {
      const { iconCenters } = renderDmgBackground({ scale });
      assert.deepEqual(iconCenters, { app: [150, 190], applications: [450, 190] });
    }
  });

  it('when rendered then the top corners are #f6f7f9 and the bottom corners #e9ebef', () => {
    const img = renderDmgBackground({ scale: 2 });
    assert.deepEqual(px(img, 0, 0), [0xf6, 0xf7, 0xf9, 255]);
    assert.deepEqual(px(img, img.width - 1, 0), [0xf6, 0xf7, 0xf9, 255]);
    assert.deepEqual(px(img, 0, img.height - 1), [0xe9, 0xeb, 0xef, 255]);
    assert.deepEqual(px(img, img.width - 1, img.height - 1), [0xe9, 0xeb, 0xef, 255]);
  });

  it('when rendered then the background darkens monotonically from top to bottom', () => {
    const img = renderDmgBackground({ scale: 1 });
    for (let y = 1; y < img.height; y++) {
      assert.ok(px(img, 5, y)[0] <= px(img, 5, y - 1)[0]);
    }
  });

  it('when rendered then a pixel on the arrow shaft is #9aa1ad', () => {
    for (const scale of [1, 2] as const) {
      const img = renderDmgBackground({ scale });
      assert.deepEqual(px(img, 300 * scale, 190 * scale), [0x9a, 0xa1, 0xad, 255]);
    }
  });

  it('when rendered then a pixel far from the arrow is plain background', () => {
    const img = renderDmgBackground({ scale: 2 });
    assert.deepEqual(px(img, 300, 700), px(img, 0, 700));
    assert.deepEqual(px(img, 300 * 2, 100 * 2), px(img, 0, 100 * 2));
  });

  it('when rendered then the arrow edge is anti-aliased (intermediate colors exist)', () => {
    const img = renderDmgBackground({ scale: 2 });
    const bg = px(img, 0, 190 * 2 - 3);
    const mid = px(img, 300 * 2, 190 * 2 - 3);
    assert.ok(mid[0] < bg[0] && mid[0] > 0x9a, `got ${mid}`);
  });

  it('when rendered then the arrow is horizontally centered between the icon slots', () => {
    for (const scale of [1, 2] as const) {
      const img = renderDmgBackground({ scale });
      let min = Infinity, max = -Infinity;
      for (let y = 0; y < img.height; y++) {
        const bg = px(img, 0, y);
        for (let x = 0; x < img.width; x++) {
          if (px(img, x, y).some((v, i) => v !== bg[i])) { min = Math.min(min, x); max = Math.max(max, x); }
        }
      }
      assert.ok(max > min, 'arrow pixels exist');
      const center = (min + max + 1) / 2;
      assert.ok(Math.abs(center - 300 * scale) <= 1, `center ${center}`);
      assert.ok(min > 150 * scale && max < 450 * scale, 'arrow stays between the icon slots');
    }
  });

  it('when rendered twice then the bytes are identical', () => {
    assert.deepEqual(renderDmgBackground({ scale: 2 }).rgba, renderDmgBackground({ scale: 2 }).rgba);
  });

  it('when rendered then alpha is 255 everywhere', () => {
    const { rgba } = renderDmgBackground({ scale: 2 });
    for (let i = 3; i < rgba.length; i += 4) assert.equal(rgba[i], 255);
  });
});


describe('given the shared DMG layout', () => {
  it('when the background is rendered, then its size and icon centers are the shared layout values', () => {
    const image = renderDmgBackground({ scale: 1 });
    assert.deepEqual([image.width, image.height], [DMG_WINDOW.width, DMG_WINDOW.height]);
    assert.deepEqual(image.iconCenters, { app: [...DMG_ICON_CENTERS.app], applications: [...DMG_ICON_CENTERS.applications] });
  });
});
