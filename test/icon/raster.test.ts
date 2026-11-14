import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rasterizeSvg } from '../../src/icon/raster.ts';
import { parseSvg } from '../../src/icon/svg.ts';
import { near, pixel, svgOf } from './helpers.ts';

const RED = [255, 0, 0, 255];
const CLEAR = [0, 0, 0, 0];
const render = (body: string, size = 100, viewBox = '0 0 100 100') => rasterizeSvg(svgOf(body, viewBox), size);
const alphaSum = (rgba: Uint8Array) => { let s = 0; for (let i = 3; i < rgba.length; i += 4) s += rgba[i]; return s / 255; };

describe('given the output buffer', () => {
  it('when rasterizing an empty svg then it is size*size*4 bytes, fully transparent', () => {
    const out = render('', 8);
    assert.equal(out.length, 8 * 8 * 4);
    assert.ok(out.every((b) => b === 0));
  });

  it('when rasterizing a full-viewBox rect then every pixel is opaque', () => {
    const out = render('<rect width="100" height="100" fill="red"/>', 10);
    for (let i = 0; i < 100; i++) assert.deepEqual([...out.subarray(i * 4, i * 4 + 4)], RED);
  });

  it('when the size is not a positive integer then it throws', () => {
    assert.throws(() => rasterizeSvg(svgOf(''), 0), /size must be a positive integer/);
    assert.throws(() => rasterizeSvg(svgOf(''), 2.5), /size must be a positive integer/);
  });

  it('when given a parsed document then it renders the same as the source', () => {
    const src = svgOf('<circle cx="50" cy="50" r="30" fill="red"/>');
    assert.deepEqual(rasterizeSvg(parseSvg(src), 64), rasterizeSvg(src, 64));
  });

  it('when rendered twice then the bytes are identical', () => {
    const src = svgOf('<circle cx="50" cy="50" r="30" fill="red" stroke="blue" stroke-width="7"/><path d="M5 5 Q50 90 95 5" stroke="green" fill="none" stroke-linecap="round"/>');
    assert.ok(Buffer.from(rasterizeSvg(src, 96)).equals(Buffer.from(rasterizeSvg(src, 96))));
  });
});

describe('given a rect', () => {
  const out = render('<rect x="20" y="20" width="60" height="60" fill="red"/>');
  it('when a pixel is inside then it is opaque, outside transparent, at pixel-aligned edges', () => {
    assert.deepEqual(pixel(out, 100, 50, 50), RED);
    assert.deepEqual(pixel(out, 100, 20, 20), RED);
    assert.deepEqual(pixel(out, 100, 79, 79), RED);
    assert.deepEqual(pixel(out, 100, 19, 50), CLEAR);
    assert.deepEqual(pixel(out, 100, 80, 50), CLEAR);
    assert.deepEqual(pixel(out, 100, 50, 19), CLEAR);
    assert.deepEqual(pixel(out, 100, 50, 80), CLEAR);
  });

  it('when an edge falls mid-pixel then alpha is the fractional coverage with straight (unpremultiplied) color', () => {
    const o = render('<rect x="10.5" y="10" width="10" height="10" fill="white"/>');
    const p = pixel(o, 100, 10, 15);
    assert.deepEqual(p.slice(0, 3), [255, 255, 255]);
    near(p[3], 128, 1);
    assert.deepEqual(pixel(o, 100, 11, 15), [255, 255, 255, 255]);
    near(pixel(o, 100, 20, 15)[3], 128, 1);
  });

  it('when the vertical edge is fractional then coverage is quantized to quarter pixels at worst', () => {
    const o = render('<rect x="10" y="10.25" width="10" height="10" fill="white"/>');
    near(pixel(o, 100, 15, 10)[3], 191, 2);
  });

  it('when the rect has rounded corners then the corners are transparent and the edges opaque', () => {
    const o = render('<rect width="100" height="100" rx="30" fill="red"/>');
    assert.deepEqual(pixel(o, 100, 1, 1), CLEAR);
    assert.deepEqual(pixel(o, 100, 98, 98), CLEAR);
    assert.deepEqual(pixel(o, 100, 50, 0), RED);
    assert.deepEqual(pixel(o, 100, 0, 50), RED);
    assert.deepEqual(pixel(o, 100, 15, 15), RED);
    const a = pixel(o, 100, 8, 8)[3]; // the corner arc passes through (8.79, 8.79) = 30 - 30*cos(45deg)
    assert.ok(a > 0 && a < 255, `edge alpha ${a}`);
  });
});

describe('given a circle', () => {
  const out = render('<circle cx="50" cy="50" r="40" fill="red"/>');
  it('when sampled then center is opaque, corners transparent and the diagonal edge anti-aliased', () => {
    assert.deepEqual(pixel(out, 100, 50, 50), RED);
    assert.deepEqual(pixel(out, 100, 2, 2), CLEAR);
    const a = pixel(out, 100, 78, 21)[3];
    assert.ok(a > 0 && a < 255, `edge alpha ${a}`);
  });

  it('when the covered area is summed then it matches pi r^2 within 0.5%', () => {
    near(alphaSum(out) / (Math.PI * 1600), 1, 0.005);
  });

  it('when scaled up then the area scales with it', () => {
    near(alphaSum(render('<circle cx="50" cy="50" r="40" fill="red"/>', 300)) / (Math.PI * 1600 * 9), 1, 0.005);
  });
});

describe('given the viewBox mapping', () => {
  it('when the viewBox is smaller than the output then it is scaled up', () => {
    const o = render('<rect width="5" height="10" fill="red"/>', 100, '0 0 10 10');
    assert.deepEqual(pixel(o, 100, 49, 50), RED);
    assert.deepEqual(pixel(o, 100, 51, 50), CLEAR);
  });

  it('when the viewBox is not square then it is fitted and centered with transparent bands', () => {
    const o = render('<rect width="20" height="10" fill="red"/>', 100, '0 0 20 10');
    assert.deepEqual(pixel(o, 100, 50, 10), CLEAR);
    assert.deepEqual(pixel(o, 100, 50, 24), CLEAR);
    assert.deepEqual(pixel(o, 100, 50, 25), RED);
    assert.deepEqual(pixel(o, 100, 50, 74), RED);
    assert.deepEqual(pixel(o, 100, 50, 75), CLEAR);
    assert.deepEqual(pixel(o, 100, 0, 25), RED);
    assert.deepEqual(pixel(o, 100, 99, 74), RED);
  });

  it('when the viewBox is tall then it is centered horizontally', () => {
    const o = render('<rect width="10" height="20" fill="red"/>', 100, '0 0 10 20');
    assert.deepEqual(pixel(o, 100, 24, 50), CLEAR);
    assert.deepEqual(pixel(o, 100, 25, 50), RED);
    assert.deepEqual(pixel(o, 100, 74, 50), RED);
    assert.deepEqual(pixel(o, 100, 75, 50), CLEAR);
  });

  it('when the viewBox has an origin then content is shifted by it', () => {
    const o = render('<rect x="50" y="50" width="10" height="10" fill="red"/>', 100, '50 50 100 100');
    assert.deepEqual(pixel(o, 100, 0, 0), RED);
    assert.deepEqual(pixel(o, 100, 9, 9), RED);
    assert.deepEqual(pixel(o, 100, 10, 10), CLEAR);
  });

  it('when content lies outside the viewBox then it is clipped even inside the square canvas', () => {
    const o = render('<rect x="-50" y="-100" width="200" height="300" fill="red"/>', 100, '0 0 100 50');
    assert.deepEqual(pixel(o, 100, 50, 24), CLEAR);
    assert.deepEqual(pixel(o, 100, 50, 25), RED);
    assert.deepEqual(pixel(o, 100, 50, 75), CLEAR);
  });
});

describe('given fill rules', () => {
  const d = 'M10 10 H90 V90 H10 Z M30 30 H70 V70 H30 Z';
  it('when nonzero and the inner contour has the same direction then the hole is filled', () => {
    assert.deepEqual(pixel(render(`<path d="${d}" fill="red"/>`), 100, 50, 50), RED);
  });
  it('when evenodd then the inner contour is a hole', () => {
    const o = render(`<path d="${d}" fill="red" fill-rule="evenodd"/>`);
    assert.deepEqual(pixel(o, 100, 50, 50), CLEAR);
    assert.deepEqual(pixel(o, 100, 20, 50), RED);
  });
  it('when nonzero and the inner contour has the opposite direction then it is a hole', () => {
    const o = render('<path d="M10 10 H90 V90 H10 Z M30 30 V70 H70 V30 Z" fill="red"/>');
    assert.deepEqual(pixel(o, 100, 50, 50), CLEAR);
  });
  it('when the fill-rule comes from a style attribute then it applies', () => {
    assert.deepEqual(pixel(render(`<path d="${d}" style="fill:red;fill-rule:evenodd"/>`), 100, 50, 50), CLEAR);
  });
});

describe('given strokes', () => {
  const BLACK = [0, 0, 0, 255];
  const line = (attrs: string) => render(`<path d="M10 50 H90" fill="none" stroke="black" stroke-width="10" ${attrs}/>`);

  it('when the width is 10 then exactly 10 rows are covered', () => {
    const o = line('');
    assert.deepEqual(pixel(o, 100, 50, 44), CLEAR);
    assert.deepEqual(pixel(o, 100, 50, 45), BLACK);
    assert.deepEqual(pixel(o, 100, 50, 54), BLACK);
    assert.deepEqual(pixel(o, 100, 50, 55), CLEAR);
  });

  it('when the width is fractional then edge rows get partial alpha', () => {
    const o = render('<path d="M10 50 H90" stroke="black" stroke-width="3"/>');
    assert.deepEqual(pixel(o, 100, 50, 48), [0, 0, 0, 128]);
    assert.deepEqual(pixel(o, 100, 50, 49), BLACK);
    assert.deepEqual(pixel(o, 100, 50, 50), BLACK);
    assert.deepEqual(pixel(o, 100, 50, 51), [0, 0, 0, 128]);
  });

  it('when the cap is butt then the line ends at the endpoint', () => {
    const o = line('');
    assert.deepEqual(pixel(o, 100, 9, 50), CLEAR);
    assert.deepEqual(pixel(o, 100, 10, 50), BLACK);
    assert.deepEqual(pixel(o, 100, 89, 50), BLACK);
    assert.deepEqual(pixel(o, 100, 90, 50), CLEAR);
  });

  it('when the cap is square then it extends half the width with square corners', () => {
    const o = line('stroke-linecap="square"');
    assert.deepEqual(pixel(o, 100, 4, 50), CLEAR);
    assert.deepEqual(pixel(o, 100, 5, 50), BLACK);
    assert.deepEqual(pixel(o, 100, 5, 45), BLACK);
    assert.deepEqual(pixel(o, 100, 94, 54), BLACK);
    assert.deepEqual(pixel(o, 100, 95, 50), CLEAR);
  });

  it('when the cap is round then it extends half the width but the corners are rounded off', () => {
    const o = line('stroke-linecap="round"');
    assert.deepEqual(pixel(o, 100, 7, 50), BLACK);
    assert.deepEqual(pixel(o, 100, 5, 45)[3], 0);
    assert.deepEqual(pixel(o, 100, 3, 50), CLEAR);
    const a = pixel(o, 100, 6, 46)[3];
    assert.ok(a > 0 && a < 255, `cap edge alpha ${a}`);
  });

  const box = (join: string, extra = '') => render(`<rect x="20" y="20" width="60" height="60" fill="none" stroke="black" stroke-width="10" stroke-linejoin="${join}" ${extra}/>`);

  it('when stroking a rect then the stroke is centered on the outline', () => {
    const o = box('miter');
    assert.deepEqual(pixel(o, 100, 17, 50), BLACK);
    assert.deepEqual(pixel(o, 100, 24, 50), BLACK);
    assert.deepEqual(pixel(o, 100, 14, 50), CLEAR);
    assert.deepEqual(pixel(o, 100, 26, 50), CLEAR);
    assert.deepEqual(pixel(o, 100, 50, 50), CLEAR);
  });

  it('when the join is miter then the outer corner is square', () => {
    assert.deepEqual(pixel(box('miter'), 100, 15, 15), BLACK);
    assert.deepEqual(pixel(box('miter'), 100, 84, 84), BLACK);
  });

  it('when the join is round then the outer corner is rounded', () => {
    const o = box('round');
    assert.deepEqual(pixel(o, 100, 15, 15), CLEAR);
    assert.deepEqual(pixel(o, 100, 20, 16), BLACK);
    assert.deepEqual(pixel(o, 100, 16, 20), BLACK);
  });

  it('when the join is bevel then the outer corner is cut diagonally', () => {
    const o = box('bevel');
    assert.deepEqual(pixel(o, 100, 15, 15), CLEAR);
    assert.deepEqual(pixel(o, 100, 17, 19), BLACK);
    const a = pixel(o, 100, 17, 17)[3]; // on the bevel line x + y = 35 -> pixel center 17.5+17.5
    assert.ok(a > 0 && a < 255, `bevel alpha ${a}`);
  });

  it('when a miter exceeds the limit of 4 then it falls back to a bevel', () => {
    const o = render('<path d="M10 50 H50 L10 55" fill="none" stroke="black" stroke-width="4" stroke-linejoin="miter"/>');
    assert.deepEqual(pixel(o, 100, 60, 50), CLEAR);
    assert.deepEqual(pixel(o, 100, 56, 50), CLEAR);
    assert.deepEqual(pixel(o, 100, 30, 50), BLACK);
  });

  it('when the miter ratio is under the limit then the tip is kept', () => {
    // 90 degree corner: ratio sqrt(2) < 4 (checked above); a 45 degree corner has ratio ~2.6 < 4 and reaches past the bevel
    const o = render('<path d="M10 50 H60 L20 20" fill="none" stroke="black" stroke-width="6" stroke-linejoin="miter"/>');
    assert.ok(pixel(o, 100, 62, 50)[3] > 0);
  });

  it('when the path is closed then the last join is drawn instead of caps', () => {
    const o = render('<path d="M20 20 H80 V80 H20 Z" fill="none" stroke="black" stroke-width="10"/>');
    assert.deepEqual(pixel(o, 100, 15, 15), BLACK);
    assert.deepEqual(pixel(o, 100, 17, 17), BLACK);
  });

  it('when stroke-opacity is set then the stroke alpha follows', () => {
    const o = render('<path d="M10 50 H90" stroke="black" stroke-width="10" stroke-opacity="0.5"/>');
    assert.deepEqual(pixel(o, 100, 50, 50), [0, 0, 0, 128]);
  });

  it('when the group is scaled then the stroke width scales with it', () => {
    const o = render('<g transform="scale(2)"><path d="M5 25 H45" stroke="black" stroke-width="5"/></g>');
    assert.deepEqual(pixel(o, 100, 50, 44), CLEAR);
    assert.deepEqual(pixel(o, 100, 50, 45), BLACK);
    assert.deepEqual(pixel(o, 100, 50, 54), BLACK);
    assert.deepEqual(pixel(o, 100, 50, 55), CLEAR);
  });

  it('when fill and stroke are both set then the stroke is painted over the fill', () => {
    const o = render('<rect x="20" y="20" width="60" height="60" fill="red" stroke="blue" stroke-width="10"/>');
    assert.deepEqual(pixel(o, 100, 20, 50), [0, 0, 255, 255]);
    assert.deepEqual(pixel(o, 100, 30, 50), RED);
    assert.deepEqual(pixel(o, 100, 14, 50), CLEAR);
  });

  it('when stroking a circle then the ring area matches the analytic value', () => {
    const o = render('<circle cx="50" cy="50" r="30" fill="none" stroke="black" stroke-width="6"/>');
    near(alphaSum(o) / (Math.PI * (33 * 33 - 27 * 27)), 1, 0.01);
  });
});

describe('given transforms', () => {
  const rect = '<rect width="10" height="10" fill="red"/>';
  it('when translate precedes scale then the translation is not scaled', () => {
    const o = render(`<g transform="translate(20,0) scale(2)">${rect}</g>`);
    assert.deepEqual(pixel(o, 100, 20, 5), RED);
    assert.deepEqual(pixel(o, 100, 39, 19), RED);
    assert.deepEqual(pixel(o, 100, 40, 5), CLEAR);
    assert.deepEqual(pixel(o, 100, 19, 5), CLEAR);
    assert.deepEqual(pixel(o, 100, 30, 20), CLEAR);
  });
  it('when scale precedes translate then the translation is scaled', () => {
    const o = render(`<g transform="scale(2) translate(20,0)">${rect}</g>`);
    assert.deepEqual(pixel(o, 100, 40, 5), RED);
    assert.deepEqual(pixel(o, 100, 59, 19), RED);
    assert.deepEqual(pixel(o, 100, 39, 5), CLEAR);
    assert.deepEqual(pixel(o, 100, 60, 5), CLEAR);
  });
  it('when rotating 90 degrees about a center then the rect lands where expected', () => {
    // rect 10..40 x 10..20 rotated about (25,15): becomes x 20..30, y 0..30
    const o = render('<rect x="10" y="10" width="30" height="10" fill="red" transform="rotate(90,25,15)"/>');
    assert.deepEqual(pixel(o, 100, 25, 2), RED);
    assert.deepEqual(pixel(o, 100, 25, 27), RED);
    assert.deepEqual(pixel(o, 100, 15, 15), CLEAR);
    assert.deepEqual(pixel(o, 100, 25, 31), CLEAR);
  });
  it('when matrix() mirrors horizontally then content is mirrored', () => {
    const o = render('<g transform="matrix(-1 0 0 1 100 0)"><rect width="10" height="10" fill="red"/></g>');
    assert.deepEqual(pixel(o, 100, 95, 5), RED);
    assert.deepEqual(pixel(o, 100, 5, 5), CLEAR);
  });
});

describe('given curves', () => {
  it('when a cubic arch is filled then it passes through its analytic midpoint (50,25)', () => {
    const o = render('<path d="M0 100 C0 0 100 0 100 100 Z" fill="red"/>');
    assert.deepEqual(pixel(o, 100, 50, 27), RED);
    assert.deepEqual(pixel(o, 100, 50, 22), CLEAR);
    assert.ok(pixel(o, 100, 50, 24)[3] < 5, 'row above the apex (y=25.0) is empty');
    assert.ok(pixel(o, 100, 50, 25)[3] > 250, 'row below the apex is filled');
  });

  it('when a quadratic arch is filled then it passes through its midpoint (50,50)', () => {
    const o = render('<path d="M0 100 Q50 0 100 100 Z" fill="red"/>');
    assert.deepEqual(pixel(o, 100, 50, 52), RED);
    assert.deepEqual(pixel(o, 100, 50, 47), CLEAR);
  });

  it('when a semicircle arc is filled then it is the upper half disc', () => {
    const o = render('<path d="M10 50 A40 40 0 0 1 90 50 Z" fill="red"/>');
    assert.deepEqual(pixel(o, 100, 50, 11), RED);
    assert.deepEqual(pixel(o, 100, 50, 8), CLEAR);
    assert.deepEqual(pixel(o, 100, 50, 60), CLEAR);
    assert.deepEqual(pixel(o, 100, 20, 45), RED);
    near(alphaSum(o) / (Math.PI * 1600 / 2), 1, 0.006);
  });

  it('when a large arc is used then more than a half disc is filled', () => {
    const o = render('<path d="M50 10 A40 40 0 1 1 49.99 10 Z" fill="red"/>');
    near(alphaSum(o) / (Math.PI * 1600), 1, 0.02);
  });

  it('when a curve is flattened then the polygon stays within ~0.1px of a true circle', () => {
    // sample edge pixels of a big circle: every pixel strictly inside r-0.6 is opaque and strictly outside r+0.6 is empty
    const o = render('<circle cx="50" cy="50" r="45" fill="red"/>', 100);
    for (let a = 0; a < 360; a += 7) {
      const rad = (a * Math.PI) / 180;
      const inside = pixel(o, 100, Math.floor(50 + 44 * Math.cos(rad)), Math.floor(50 + 44 * Math.sin(rad)));
      const outside = pixel(o, 100, Math.floor(50 + 46.5 * Math.cos(rad)), Math.floor(50 + 46.5 * Math.sin(rad)));
      assert.ok(inside[3] > 200, `inside at ${a}: ${inside}`);
      assert.ok(outside[3] < 55, `outside at ${a}: ${outside}`);
    }
  });
});

describe('given gradients', () => {
  const lin = (attrs: string, stops = '<stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/>', shape = '<rect width="100" height="100" fill="url(#g)"/>') =>
    render(`<defs><linearGradient id="g" ${attrs}>${stops}</linearGradient></defs>${shape}`);

  it('when a bounding-box linear gradient runs left to right then endpoints and midpoint have the stop colors', () => {
    const o = lin('');
    const left = pixel(o, 100, 0, 50), mid = pixel(o, 100, 49, 50), right = pixel(o, 100, 99, 50);
    near(left[0], 253, 3); near(left[2], 2, 3);
    near(mid[0], 128, 3); near(mid[2], 128, 3);
    near(right[0], 2, 3); near(right[2], 253, 3);
    assert.equal(left[3], 255);
  });

  it('when userSpaceOnUse stops are inside the shape then the outside is padded with the end colors', () => {
    const o = lin('gradientUnits="userSpaceOnUse" x1="25" y1="0" x2="75" y2="0"');
    assert.deepEqual(pixel(o, 100, 10, 50), RED);
    assert.deepEqual(pixel(o, 100, 90, 50), [0, 0, 255, 255]);
    near(pixel(o, 100, 49, 50)[0], 128, 3);
  });

  it('when the gradient is vertical then color varies by row only', () => {
    const o = lin('x2="0" y2="1"');
    assert.deepEqual(pixel(o, 100, 3, 50), pixel(o, 100, 90, 50));
    near(pixel(o, 100, 3, 0)[0], 253, 3);
    near(pixel(o, 100, 3, 99)[2], 253, 3);
  });

  it('when the gradient is applied to a shape not at the origin then the bounding box moves with it', () => {
    const o = lin('', undefined, '<rect x="40" y="0" width="20" height="100" fill="url(#g)"/>');
    near(pixel(o, 100, 40, 50)[0], 242, 8);
    near(pixel(o, 100, 59, 50)[2], 242, 8);
  });

  it('when a gradient has three stops then the middle stop color appears at its offset', () => {
    const o = lin('', '<stop offset="0" stop-color="red"/><stop offset=".5" stop-color="lime"/><stop offset="1" stop-color="blue"/>');
    const mid = pixel(o, 100, 50, 50);
    assert.deepEqual([mid[0] < 6, mid[1] > 245, mid[2] < 6], [true, true, true]);
  });

  it('when stops have opacity then alpha is interpolated and colors stay straight', () => {
    const o = lin('', '<stop offset="0" stop-color="red"/><stop offset="1" stop-color="red" stop-opacity="0"/>');
    near(pixel(o, 100, 49, 50)[3], 128, 3);
    assert.equal(pixel(o, 100, 49, 50)[0], 255);
  });

  it('when a stroke uses a gradient then the stroke is colored by it', () => {
    const o = render('<defs><linearGradient id="g"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs><rect x="10" y="10" width="80" height="80" fill="none" stroke="url(#g)" stroke-width="8"/>');
    near(pixel(o, 100, 12, 50)[0], 247, 8);
    near(pixel(o, 100, 87, 50)[2], 247, 8);
  });

  it('when a radial gradient is centered then t follows the distance from the center', () => {
    const o = render('<defs><radialGradient id="g"><stop offset="0" stop-color="white"/><stop offset="1" stop-color="black"/></radialGradient></defs><rect width="100" height="100" fill="url(#g)"/>');
    near(pixel(o, 100, 50, 50)[0], 255, 6);
    near(pixel(o, 100, 74, 50)[0], 128, 6); // r = 0.5 * 100 = 50 -> halfway at 25 px
    assert.deepEqual(pixel(o, 100, 1, 1).slice(0, 3), [0, 0, 0]); // corner is beyond r: padded
    near(pixel(o, 100, 99, 50)[0], 0, 6);
  });

  it('when a radial gradient has a focal point then the focus is the t=0 color', () => {
    const o = render('<defs><radialGradient id="g" fx="0.25" fy="0.5"><stop offset="0" stop-color="white"/><stop offset="1" stop-color="black"/></radialGradient></defs><rect width="100" height="100" fill="url(#g)"/>');
    near(pixel(o, 100, 25, 50)[0], 255, 8);
    assert.ok(pixel(o, 100, 25, 50)[0] > pixel(o, 100, 50, 50)[0]);
    assert.ok(pixel(o, 100, 50, 50)[0] > pixel(o, 100, 90, 50)[0]);
  });

  it('when a userSpaceOnUse radial gradient is used then center and radius are in user units', () => {
    const o = render('<defs><radialGradient id="g" gradientUnits="userSpaceOnUse" cx="20" cy="20" r="40"><stop offset="0" stop-color="white"/><stop offset="1" stop-color="black"/></radialGradient></defs><rect width="100" height="100" fill="url(#g)"/>');
    near(pixel(o, 100, 20, 20)[0], 253, 6);
    near(pixel(o, 100, 40, 20)[0], 128, 6);
    near(pixel(o, 100, 80, 80)[0], 0, 2);
  });
});

describe('given opacity and compositing', () => {
  it('when a shape has opacity 0.5 then alpha is 128 over transparent', () => {
    assert.deepEqual(pixel(render('<rect width="100" height="100" fill="white" opacity=".5"/>'), 100, 5, 5), [255, 255, 255, 128]);
  });

  it('when fill-opacity and opacity are both 0.5 then alpha is 64', () => {
    assert.deepEqual(pixel(render('<rect width="100" height="100" fill="white" fill-opacity=".5" opacity=".5"/>'), 100, 5, 5), [255, 255, 255, 64]);
  });

  it('when the fill color has its own alpha then it is honored', () => {
    assert.deepEqual(pixel(render('<rect width="100" height="100" fill="rgba(255,0,0,0.5)"/>'), 100, 5, 5), [255, 0, 0, 128]);
    assert.deepEqual(pixel(render('<rect width="100" height="100" fill="#ff000080"/>'), 100, 5, 5), [255, 0, 0, 128]);
  });

  it('when 50% red is drawn over opaque black then the result is half red and opaque', () => {
    const o = render('<rect width="100" height="100" fill="black"/><rect width="100" height="100" fill="red" opacity=".5"/>');
    assert.deepEqual(pixel(o, 100, 5, 5), [128, 0, 0, 255]);
  });

  it('when 50% blue is drawn over opaque red then colors mix by alpha', () => {
    const o = render('<rect width="100" height="100" fill="red"/><rect width="100" height="100" fill="blue" opacity=".5"/>');
    assert.deepEqual(pixel(o, 100, 5, 5), [128, 0, 128, 255]);
  });

  it('when two 50% layers overlap on transparency then alpha combines to 75% and the color stays straight', () => {
    const o = render('<rect width="100" height="100" fill="white" opacity=".5"/><rect width="100" height="100" fill="white" opacity=".5"/>');
    assert.deepEqual(pixel(o, 100, 5, 5), [255, 255, 255, 191]);
  });

  it('when an element with fill and stroke has opacity then it is composited as a group (no fill showing through the stroke)', () => {
    const o = render('<rect x="20" y="20" width="60" height="60" fill="red" stroke="blue" stroke-width="10" opacity=".5"/>');
    assert.deepEqual(pixel(o, 100, 20, 50), [0, 0, 255, 128]);
    assert.deepEqual(pixel(o, 100, 40, 50), [255, 0, 0, 128]);
  });

  it('when a group has opacity then children inherit it multiplicatively', () => {
    const o = render('<g opacity=".5"><rect width="100" height="100" fill="white" opacity=".5"/></g>');
    assert.deepEqual(pixel(o, 100, 5, 5), [255, 255, 255, 64]);
  });

  it('when a pixel is half covered by an opaque shape over an opaque one then it blends the two', () => {
    const o = render('<rect width="100" height="100" fill="black"/><rect x="10.5" width="50" height="100" fill="white"/>');
    near(pixel(o, 100, 10, 50)[0], 128, 1);
    assert.equal(pixel(o, 100, 10, 50)[3], 255);
  });
});
