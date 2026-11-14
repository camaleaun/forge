import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSvg } from '../../src/icon/svg.ts';

const wrap = (body: string, attrs = 'viewBox="0 0 100 100"') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;

describe('given the svg root element', () => {
  it('when it has a viewBox then the document exposes it', () => {
    const doc = parseSvg(wrap('<rect width="1" height="1"/>', 'viewBox="0 0 24 48"'));
    assert.deepEqual(doc.viewBox, { x: 0, y: 0, width: 24, height: 48 });
  });

  it('when it only has width and height (px allowed) then the viewBox is 0 0 w h', () => {
    const doc = parseSvg(wrap('', 'width="32px" height="16"'));
    assert.deepEqual(doc.viewBox, { x: 0, y: 0, width: 32, height: 16 });
    assert.equal(doc.width, 32);
    assert.equal(doc.height, 16);
  });

  it('when it has neither viewBox nor width/height then it throws with line:col', () => {
    assert.throws(() => parseSvg('<svg></svg>'), { message: 'icon.svg:1:1: <svg> needs a viewBox or width and height' });
  });

  it('when the root is not svg then it throws', () => {
    assert.throws(() => parseSvg('<html></html>'), { message: 'icon.svg:1:1: root element must be <svg>, found <html>' });
  });

  it('when comments, xml declaration, doctype, title and desc are present then they are ignored', () => {
    const src = `<?xml version="1.0"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<!-- hello <rect/> -->
<svg viewBox="0 0 10 10"><title>T</title><desc>D</desc><rect width="5" height="5"/></svg>`;
    assert.equal(parseSvg(src).shapes.length, 1);
  });
});

describe('given unsupported content', () => {
  it('when an unsupported element appears then the error names it with line:col and the supported list', () => {
    const src = '<svg viewBox="0 0 10 10">\n  <g>\n    <text>hi</text>\n  </g>\n</svg>';
    assert.throws(() => parseSvg(src), {
      message: 'icon.svg:3:5: unsupported element <text> (supported: svg, g, defs, linearGradient, radialGradient, stop, rect, circle, ellipse, path, polygon)',
    });
  });

  it('when an unsupported attribute appears then the error names element and attribute with line:col', () => {
    const src = '<svg viewBox="0 0 10 10">\n  <rect width="1" height="1" filter="url(#f)"/>\n</svg>';
    assert.throws(() => parseSvg(src), { message: 'icon.svg:2:30: unsupported attribute filter on <rect>' });
  });

  it('when a style property is unsupported then the error names it', () => {
    const src = '<svg viewBox="0 0 10 10"><rect width="1" height="1" style="fill:red;stroke-dasharray:2"/></svg>';
    assert.throws(() => parseSvg(src), { message: 'icon.svg:1:53: unsupported style property stroke-dasharray on <rect>' });
  });

  it('when a custom file name is given then errors use it', () => {
    assert.throws(() => parseSvg('<svg viewBox="0 0 1 1"><text/></svg>', { file: 'logo.svg' }), /^Error: logo\.svg:1:24: unsupported element <text>/);
  });

  it('when a color cannot be parsed then the error names the attribute', () => {
    assert.throws(() => parseSvg(wrap('<rect width="1" height="1" fill="notacolor"/>')), /icon\.svg:1:\d+: invalid fill "notacolor" on <rect>/);
  });

  it('when an enum value is invalid then the error names the attribute', () => {
    assert.throws(() => parseSvg(wrap('<rect width="1" height="1" stroke-linecap="triangle"/>')), /invalid stroke-linecap "triangle" on <rect>/);
  });

  it('when markup is malformed then it throws with a position', () => {
    assert.throws(() => parseSvg('<svg viewBox="0 0 1 1"><rect></svg>'), /icon\.svg:1:\d+: mismatched closing tag <\/svg>/);
  });
});

describe('given basic shapes', () => {
  it('when a rect is parsed then it is a closed four-line subpath with a bounding box', () => {
    const [s] = parseSvg(wrap('<rect x="10" y="20" width="30" height="40"/>')).shapes;
    assert.deepEqual(s.subpaths, [{ start: [10, 20], closed: true, segs: [['L', 40, 20], ['L', 40, 60], ['L', 10, 60]] }]);
    assert.deepEqual(s.bbox, { x: 10, y: 20, width: 30, height: 40 });
  });

  it('when a rect has rx only then ry defaults to rx and corners are curves', () => {
    const [s] = parseSvg(wrap('<rect width="100" height="100" rx="10"/>')).shapes;
    const segs = s.subpaths[0].segs;
    assert.equal(segs.filter((g: any) => g[0] === 'C').length, 4);
    assert.deepEqual(s.subpaths[0].start, [10, 0]);
  });

  it('when rx exceeds half the width then it is clamped', () => {
    const [s] = parseSvg(wrap('<rect width="20" height="20" rx="50"/>')).shapes;
    assert.deepEqual(s.bbox, { x: 0, y: 0, width: 20, height: 20 });
    assert.deepEqual(s.subpaths[0].start, [10, 0]);
  });

  it('when a circle is parsed then its bbox is the circle box', () => {
    const [s] = parseSvg(wrap('<circle cx="50" cy="40" r="10"/>')).shapes;
    assert.deepEqual(s.bbox, { x: 40, y: 30, width: 20, height: 20 });
    assert.equal(s.subpaths[0].segs.length, 4);
  });

  it('when an ellipse is parsed then its bbox uses rx and ry', () => {
    const [s] = parseSvg(wrap('<ellipse cx="50" cy="50" rx="30" ry="10"/>')).shapes;
    assert.deepEqual(s.bbox, { x: 20, y: 40, width: 60, height: 20 });
  });

  it('when a polygon is parsed then it is a closed polyline', () => {
    const [s] = parseSvg(wrap('<polygon points="0,0 10,0 5,10"/>')).shapes;
    assert.deepEqual(s.subpaths, [{ start: [0, 0], closed: true, segs: [['L', 10, 0], ['L', 5, 10]] }]);
  });

  it('when a shape has zero size then it is dropped', () => {
    assert.equal(parseSvg(wrap('<rect width="0" height="10"/><circle r="0"/>')).shapes.length, 0);
  });
});

describe('given presentation attributes and styles', () => {
  it('when nothing is set then the SVG defaults apply', () => {
    const [s] = parseSvg(wrap('<rect width="1" height="1"/>')).shapes;
    assert.deepEqual(s.fill, { type: 'color', color: [0, 0, 0, 1] });
    assert.deepEqual(s.stroke, { type: 'none' });
    assert.equal(s.fillOpacity, 1);
    assert.equal(s.strokeOpacity, 1);
    assert.equal(s.strokeWidth, 1);
    assert.equal(s.lineCap, 'butt');
    assert.equal(s.lineJoin, 'miter');
    assert.equal(s.fillRule, 'nonzero');
    assert.equal(s.opacity, 1);
  });

  it('when attributes are set then they are read', () => {
    const [s] = parseSvg(wrap('<rect width="1" height="1" fill="#f00" fill-opacity=".5" stroke="blue" stroke-width="3" stroke-opacity="0.25" stroke-linecap="round" stroke-linejoin="bevel" fill-rule="evenodd" opacity="0.5"/>')).shapes;
    assert.deepEqual(s.fill, { type: 'color', color: [255, 0, 0, 1] });
    assert.deepEqual(s.stroke, { type: 'color', color: [0, 0, 255, 1] });
    assert.equal(s.fillOpacity, 0.5);
    assert.equal(s.strokeOpacity, 0.25);
    assert.equal(s.strokeWidth, 3);
    assert.equal(s.lineCap, 'round');
    assert.equal(s.lineJoin, 'bevel');
    assert.equal(s.fillRule, 'evenodd');
    assert.equal(s.opacity, 0.5);
  });

  it('when a style attribute is set then it overrides the presentation attribute', () => {
    const [s] = parseSvg(wrap('<rect width="1" height="1" fill="red" style="fill: #00ff00; stroke:white ;stroke-width:2px"/>')).shapes;
    assert.deepEqual(s.fill, { type: 'color', color: [0, 255, 0, 1] });
    assert.deepEqual(s.stroke, { type: 'color', color: [255, 255, 255, 1] });
    assert.equal(s.strokeWidth, 2);
  });

  it('when a group sets inheritable properties then children inherit and may override', () => {
    const doc = parseSvg(wrap('<g fill="red" stroke="blue"><rect width="1" height="1"/><rect width="1" height="1" fill="lime"/></g>'));
    assert.deepEqual(doc.shapes[0].fill, { type: 'color', color: [255, 0, 0, 1] });
    assert.deepEqual(doc.shapes[1].fill, { type: 'color', color: [0, 255, 0, 1] });
    assert.deepEqual(doc.shapes[1].stroke, { type: 'color', color: [0, 0, 255, 1] });
  });

  it('when opacity is set on group and element then it multiplies and is not inherited otherwise', () => {
    const doc = parseSvg(wrap('<g opacity=".5"><rect width="1" height="1" opacity=".5"/></g><rect width="1" height="1"/>'));
    assert.equal(doc.shapes[0].opacity, 0.25);
    assert.equal(doc.shapes[1].opacity, 1);
  });

  it('when colors use every supported syntax then they parse to rgba', () => {
    const color = (v: string) => (parseSvg(wrap(`<rect width="1" height="1" fill="${v}"/>`)).shapes[0].fill as any).color;
    assert.deepEqual(color('#abc'), [170, 187, 204, 1]);
    assert.deepEqual(color('#112233'), [17, 34, 51, 1]);
    assert.deepEqual(color('#ff000080'), [255, 0, 0, 128 / 255]);
    assert.deepEqual(color('rgb(10, 20, 30)'), [10, 20, 30, 1]);
    assert.deepEqual(color('rgba(10,20,30,0.5)'), [10, 20, 30, 0.5]);
    assert.deepEqual(color('white'), [255, 255, 255, 1]);
    assert.deepEqual(color('orange'), [255, 165, 0, 1]);
    assert.deepEqual(color('transparent'), [0, 0, 0, 0]);
    assert.deepEqual(color('GREEN'), [0, 128, 0, 1]);
  });

  it('when fill is none then there is no fill paint', () => {
    const [s] = parseSvg(wrap('<rect width="1" height="1" fill="none"/>')).shapes;
    assert.deepEqual(s.fill, { type: 'none' });
  });
});

const path = (d: string) => parseSvg(wrap(`<path d="${d}"/>`)).shapes[0].subpaths;
const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

describe('given path data', () => {
  it('when absolute move, line and close are used then a closed subpath results', () => {
    assert.deepEqual(path('M10 20 L30 40 L50 20 Z'), [{ start: [10, 20], closed: true, segs: [['L', 30, 40], ['L', 50, 20]] }]);
  });

  it('when an open path has no Z then it is not closed', () => {
    assert.deepEqual(path('M0 0 L10 0')[0].closed, false);
  });

  it('when relative commands and H/V are used then coordinates accumulate', () => {
    assert.deepEqual(path('m10 10 l5 5 h10 v-5 H0 V0')[0].segs, [['L', 15, 15], ['L', 25, 15], ['L', 25, 10], ['L', 0, 10], ['L', 0, 0]]);
  });

  it('when extra pairs follow M then they are implicit lineto (relative after m)', () => {
    assert.deepEqual(path('M0 0 10 0 10 10')[0].segs, [['L', 10, 0], ['L', 10, 10]]);
    assert.deepEqual(path('m1 1 2 0 0 2')[0].segs, [['L', 3, 1], ['L', 3, 3]]);
  });

  it('when numbers are compressed then they still split correctly', () => {
    assert.deepEqual(path('M0,0L-5-5.5.5 1e1-1 2')[0].segs, [['L', -5, -5.5], ['L', 0.5, 10], ['L', -1, 2]]);
  });

  it('when C and c are used then cubic segments keep their control points', () => {
    assert.deepEqual(path('M0 0 C1 2 3 4 5 6 c1 1 2 2 3 3')[0].segs, [['C', 1, 2, 3, 4, 5, 6], ['C', 6, 7, 7, 8, 8, 9]]);
  });

  it('when S follows a cubic then the first control point is reflected', () => {
    const segs = path('M0 0 C0 10 10 20 20 20 S40 10 40 0')[0].segs;
    assert.deepEqual(segs[1], ['C', 30, 20, 40, 10, 40, 0]);
  });

  it('when S does not follow a cubic then the first control is the current point', () => {
    assert.deepEqual(path('M5 5 S10 10 20 5')[0].segs[0], ['C', 5, 5, 10, 10, 20, 5]);
  });

  it('when Q is used then it is raised to an exact cubic', () => {
    const [seg] = path('M0 0 Q30 0 30 30')[0].segs as any;
    assert.equal(seg[0], 'C');
    near(seg[1], 20); near(seg[2], 0); near(seg[3], 30); near(seg[4], 10); near(seg[5], 30); near(seg[6], 30);
  });

  it('when T follows Q then the control point is reflected', () => {
    const segs = path('M0 0 Q10 10 20 0 T40 0')[0].segs as any;
    // second quad control = (30,-10): c1 = (20,0)+2/3*((30,-10)-(20,0))
    near(segs[1][1], 20 + (2 / 3) * 10); near(segs[1][2], (2 / 3) * -10);
  });

  it('when a semicircle arc is used then it ends exactly and passes through the apex', () => {
    const segs = path('M0 0 A10 10 0 0 1 20 0')[0].segs as any;
    assert.equal(segs.length, 2);
    near(segs[0][5], 10, 1e-9); near(segs[0][6], -10, 1e-9);
    near(segs[1][5], 20, 1e-9); near(segs[1][6], 0, 1e-9);
  });

  it('when the arc sweep flag is 0 then it bulges to the other side', () => {
    const segs = path('M0 0 A10 10 0 0 0 20 0')[0].segs as any;
    near(segs[0][5], 10); near(segs[0][6], 10);
  });

  it('when arc radii are too small then they are scaled up to fit', () => {
    const segs = path('M0 0 A1 1 0 0 1 20 0')[0].segs as any;
    near(segs[0][5], 10); near(segs[0][6], -10);
  });

  it('when the arc flags are compressed against the coordinates then they parse', () => {
    const segs = path('M0 0 A10 10 0 0120 0')[0].segs as any;
    near(segs[segs.length - 1][5], 20);
  });

  it('when an arc has a zero radius then it becomes a line', () => {
    assert.deepEqual(path('M0 0 A0 5 0 0 1 20 0')[0].segs, [['L', 20, 0]]);
  });

  it('when a relative command follows Z then it starts from the subpath start', () => {
    const sp = path('M10 10 L20 10 L20 20 Z l5 5');
    assert.equal(sp.length, 2);
    assert.deepEqual(sp[1], { start: [10, 10], closed: false, segs: [['L', 15, 15]] });
  });

  it('when there are several subpaths then each is separate', () => {
    assert.equal(path('M0 0 L1 1 M5 5 L6 6 Z').length, 2);
  });

  it('when the command is unsupported or data is malformed then the error is clear', () => {
    assert.throws(() => path('M0 0 X5 5'), { message: 'icon.svg:1:69: unsupported path command X in d="M0 0 X5 5"' });
    assert.throws(() => path('M0 0 L5'), /icon\.svg:1:69: invalid path data in d="M0 0 L5"/);
    assert.throws(() => path('L5 5'), /invalid path data/);
  });
});

describe('given transforms', () => {
  const matrixOf = (t: string, el = 'rect width="1" height="1"') => parseSvg(wrap(`<g transform="${t}"><${el}/></g>`)).shapes[0].matrix;

  it('when translate then scale are listed then translate is applied last (outermost)', () => {
    assert.deepEqual(matrixOf('translate(10,20) scale(2)'), [2, 0, 0, 2, 10, 20]);
  });

  it('when scale then translate are listed then the translation is scaled', () => {
    assert.deepEqual(matrixOf('scale(2) translate(10 20)'), [2, 0, 0, 2, 20, 40]);
  });

  it('when scale has one argument then it is uniform; translate with one argument has ty 0', () => {
    assert.deepEqual(matrixOf('scale(3)'), [3, 0, 0, 3, 0, 0]);
    assert.deepEqual(matrixOf('translate(7)'), [1, 0, 0, 1, 7, 0]);
  });

  it('when rotate has an angle then it is counter-clockwise-positive in y-down space as in SVG', () => {
    const m = matrixOf('rotate(90)');
    near(m[0], 0); near(m[1], 1); near(m[2], -1); near(m[3], 0);
  });

  it('when rotate has a center then the center is a fixed point', () => {
    const m = matrixOf('rotate(90,10,10)');
    near(m[0] * 10 + m[2] * 10 + m[4], 10); near(m[1] * 10 + m[3] * 10 + m[5], 10);
  });

  it('when matrix() is used then its six numbers are taken as is', () => {
    assert.deepEqual(matrixOf('matrix(1 2 3 4 5 6)'), [1, 2, 3, 4, 5, 6]);
  });

  it('when groups are nested then matrices compose outer * inner', () => {
    const doc = parseSvg(wrap('<g transform="translate(10,0)"><g transform="scale(2)"><rect width="1" height="1" transform="translate(1,1)"/></g></g>'));
    assert.deepEqual(doc.shapes[0].matrix, [2, 0, 0, 2, 12, 2]);
  });

  it('when the transform function is unsupported or malformed then it throws', () => {
    assert.throws(() => matrixOf('skewX(10)'), /icon\.svg:1:\d+: unsupported transform function skewX/);
    assert.throws(() => matrixOf('translate(a)'), /invalid transform "translate\(a\)" on <g>/);
  });
});

describe('given gradients', () => {
  const defs = (body: string, shape = '<rect width="10" height="10" fill="url(#g)"/>') => parseSvg(wrap(`<defs>${body}</defs>${shape}`));

  it('when a linear gradient has defaults then it is objectBoundingBox left to right', () => {
    const [s] = defs('<linearGradient id="g"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient>').shapes;
    assert.deepEqual(s.fill, {
      type: 'linear', units: 'objectBoundingBox', x1: 0, y1: 0, x2: 1, y2: 0,
      stops: [{ offset: 0, color: [255, 0, 0, 1] }, { offset: 1, color: [0, 0, 255, 1] }],
    });
  });

  it('when coordinates are percentages or numbers then bounding-box values are fractions', () => {
    const [s] = defs('<linearGradient id="g" x1="0%" y1="0" x2="0" y2="100%"><stop offset="0%" stop-color="red"/><stop offset="50%" stop-color="blue"/></linearGradient>').shapes;
    const f = s.fill as any;
    assert.deepEqual([f.x1, f.y1, f.x2, f.y2], [0, 0, 0, 1]);
    assert.equal(f.stops[1].offset, 0.5);
  });

  it('when gradientUnits is userSpaceOnUse then values are kept in user units', () => {
    const [s] = defs('<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="10" y1="20" x2="30" y2="40"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient>').shapes;
    const f = s.fill as any;
    assert.equal(f.units, 'userSpaceOnUse');
    assert.deepEqual([f.x1, f.y1, f.x2, f.y2], [10, 20, 30, 40]);
  });

  it('when a radial gradient has defaults then it is centered with r 0.5 and focal = center', () => {
    const [s] = defs('<radialGradient id="g"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></radialGradient>').shapes;
    const f = s.fill as any;
    assert.deepEqual([f.type, f.cx, f.cy, f.r, f.fx, f.fy], ['radial', 0.5, 0.5, 0.5, 0.5, 0.5]);
  });

  it('when a radial gradient has fx fy then they are read', () => {
    const f = defs('<radialGradient id="g" cx="0.4" cy="0.4" r="0.6" fx="0.2" fy="0.1"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></radialGradient>').shapes[0].fill as any;
    assert.deepEqual([f.cx, f.cy, f.r, f.fx, f.fy], [0.4, 0.4, 0.6, 0.2, 0.1]);
  });

  it('when stops use stop-opacity and style then they fold into the color alpha', () => {
    const f = defs('<linearGradient id="g"><stop offset="0" style="stop-color:#00ff00;stop-opacity:.5"/><stop offset="1" stop-color="blue" stop-opacity="0.25"/></linearGradient>').shapes[0].fill as any;
    assert.deepEqual(f.stops[0].color, [0, 255, 0, 0.5]);
    assert.deepEqual(f.stops[1].color, [0, 0, 255, 0.25]);
  });

  it('when stop offsets decrease then they are clamped to be non-decreasing', () => {
    const f = defs('<linearGradient id="g"><stop offset=".6" stop-color="red"/><stop offset=".2" stop-color="blue"/></linearGradient>').shapes[0].fill as any;
    assert.deepEqual(f.stops.map((s: any) => s.offset), [0.6, 0.6]);
  });

  it('when the gradient is used via the style attribute or on a stroke then it resolves', () => {
    const doc = defs('<linearGradient id="g"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient>', '<rect width="1" height="1" style="fill:url(#g)" stroke="url(#g)"/>');
    assert.equal(doc.shapes[0].fill.type, 'linear');
    assert.equal(doc.shapes[0].stroke.type, 'linear');
  });

  it('when a gradient has no stops then it paints nothing, with one stop it is a solid color', () => {
    assert.deepEqual(defs('<linearGradient id="g"/>').shapes[0].fill, { type: 'none' });
    assert.deepEqual(defs('<linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient>').shapes[0].fill, { type: 'color', color: [255, 0, 0, 1] });
  });

  it('when the url target is missing then the error names the id', () => {
    assert.throws(() => defs('', '<rect width="1" height="1" fill="url(#nope)"/>'), /icon\.svg:1:\d+: unknown paint server #nope in fill on <rect>/);
  });

  it('when spreadMethod is not pad then it throws', () => {
    assert.throws(() => defs('<linearGradient id="g" spreadMethod="reflect"/>'), /unsupported spreadMethod "reflect" on <linearGradient>/);
  });

  it('when gradientTransform or href is used then it is reported as unsupported', () => {
    assert.throws(() => defs('<linearGradient id="g" gradientTransform="rotate(45)"/>'), /unsupported attribute gradientTransform on <linearGradient>/);
  });

  it('when a gradient is declared outside defs then it still resolves', () => {
    const doc = parseSvg(wrap('<linearGradient id="g"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient><rect width="1" height="1" fill="url(#g)"/>'));
    assert.equal(doc.shapes[0].fill.type, 'linear');
  });
});
