// Dependency-free scanline rasterizer for SvgDocument shapes.
// Anti-aliasing: 4 vertical subsamples per pixel row with exact horizontal span coverage.
// Compositing happens in premultiplied float space; output is quantized once to straight RGBA8.

import { parseSvg } from './svg.ts';
import { apply, invert, multiply } from './matrix.ts';
import type { Matrix, Paint, Rgba, SvgDocument, SvgShape, Subpath, GradientStop } from './svg.ts';

type Pt = [number, number];
const SUBSAMPLES = 4;
const FLATNESS = 0.1; // device pixels
const MITER_LIMIT = 4;

interface Coverage { x0: number; y0: number; w: number; h: number; data: Float64Array }
interface Clip { x0: number; y0: number; x1: number; y1: number }

export function rasterizeSvg(source: string | SvgDocument, size: number): Uint8Array {
  if (!Number.isInteger(size) || size <= 0) throw new RangeError(`size must be a positive integer, got ${size}`);
  const doc = typeof source === 'string' ? parseSvg(source) : source;
  const { viewBox } = doc;
  const scale = size / Math.max(viewBox.width, viewBox.height);
  const tx = (size - viewBox.width * scale) / 2 - viewBox.x * scale;
  const ty = (size - viewBox.height * scale) / 2 - viewBox.y * scale;
  const view: Matrix = [scale, 0, 0, scale, tx, ty];
  const clip: Clip = {
    x0: Math.max(0, tx + viewBox.x * scale), y0: Math.max(0, ty + viewBox.y * scale),
    x1: Math.min(size, tx + (viewBox.x + viewBox.width) * scale), y1: Math.min(size, ty + (viewBox.y + viewBox.height) * scale),
  };

  const canvas = new Float64Array(size * size * 4);
  for (const shape of doc.shapes) drawShape(canvas, size, shape, view, clip);

  const out = new Uint8Array(size * size * 4);
  for (let i = 0; i < canvas.length; i += 4) {
    const a = canvas[i + 3];
    if (a <= 0) continue;
    out[i] = quantize(canvas[i] / a);
    out[i + 1] = quantize(canvas[i + 1] / a);
    out[i + 2] = quantize(canvas[i + 2] / a);
    out[i + 3] = quantize(a);
  }
  return out;
}

const quantize = (v: number): number => Math.max(0, Math.min(255, Math.round(v * 255)));

// ---------------------------------------------------------------- shapes

function drawShape(canvas: Float64Array, size: number, shape: SvgShape, view: Matrix, clip: Clip): void {
  const m = multiply(view, shape.matrix);
  const flat = shape.subpaths.map((sp) => flattenSubpath(sp, m));
  const hasFill = shape.fill.type !== 'none';
  const hasStroke = shape.stroke.type !== 'none' && shape.strokeWidth > 0;
  if (!hasFill && !hasStroke) return;

  const grouped = shape.opacity < 1 && hasFill && hasStroke;
  const target = grouped ? new Float64Array(canvas.length) : canvas;
  const alpha = grouped ? 1 : shape.opacity;

  if (hasFill) {
    const polys = flat.map((f) => f.pts.map((p) => apply(m, p)));
    const cov = computeCoverage(polys, shape.fillRule === 'evenodd', clip);
    if (cov) paintCoverage(target, size, cov, shape.fill, shape, m, shape.fillOpacity * alpha);
  }
  if (hasStroke) {
    const polys: Pt[][] = [];
    const deviceScale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
    for (const f of flat) polys.push(...strokePolygons(f.pts, f.smooth, f.closed, shape, deviceScale).map((poly) => poly.map((p) => apply(m, p))));
    const cov = computeCoverage(polys, false, clip);
    if (cov) paintCoverage(target, size, cov, shape.stroke, shape, m, shape.strokeOpacity * alpha);
  }
  if (grouped) {
    for (let i = 0; i < canvas.length; i += 4) {
      const a = target[i + 3];
      if (a <= 0) continue;
      const k = shape.opacity, inv = 1 - a * k;
      canvas[i] = target[i] * k + canvas[i] * inv;
      canvas[i + 1] = target[i + 1] * k + canvas[i + 1] * inv;
      canvas[i + 2] = target[i + 2] * k + canvas[i + 2] * inv;
      canvas[i + 3] = a * k + canvas[i + 3] * inv;
    }
  }
}

function paintCoverage(target: Float64Array, size: number, cov: Coverage, paint: Paint, shape: SvgShape, m: Matrix, alphaMul: number): void {
  const colorAt = paintFunction(paint, shape, m);
  if (!colorAt) return;
  for (let y = 0; y < cov.h; y++) {
    for (let x = 0; x < cov.w; x++) {
      const c = cov.data[y * cov.w + x];
      if (c <= 0) continue;
      const px = cov.x0 + x, py = cov.y0 + y;
      const color = colorAt(px + 0.5, py + 0.5);
      const a = color[3] * alphaMul * Math.min(1, c);
      if (a <= 0) continue;
      const i = (py * size + px) * 4, inv = 1 - a;
      target[i] = (color[0] / 255) * a + target[i] * inv;
      target[i + 1] = (color[1] / 255) * a + target[i + 1] * inv;
      target[i + 2] = (color[2] / 255) * a + target[i + 2] * inv;
      target[i + 3] = a + target[i + 3] * inv;
    }
  }
}

// ---------------------------------------------------------------- paints

function paintFunction(paint: Paint, shape: SvgShape, m: Matrix): ((x: number, y: number) => Rgba) | null {
  if (paint.type === 'none') return null;
  if (paint.type === 'color') { const c = paint.color; return () => c; }
  const { bbox } = shape;
  if (paint.units === 'objectBoundingBox' && (bbox.width <= 0 || bbox.height <= 0)) return null;
  const inv = invert(m);
  if (!inv) return null;
  const toGradient = (x: number, y: number): Pt => {
    const [lx, ly] = apply(inv, [x, y]);
    return paint.units === 'objectBoundingBox' ? [(lx - bbox.x) / bbox.width, (ly - bbox.y) / bbox.height] : [lx, ly];
  };
  if (paint.type === 'linear') {
    const dx = paint.x2 - paint.x1, dy = paint.y2 - paint.y1, len2 = dx * dx + dy * dy;
    return (x, y) => {
      if (len2 === 0) return stopColor(paint.stops, 1);
      const [gx, gy] = toGradient(x, y);
      return stopColor(paint.stops, ((gx - paint.x1) * dx + (gy - paint.y1) * dy) / len2);
    };
  }
  return (x, y) => {
    const [gx, gy] = toGradient(x, y);
    if (paint.r <= 0) return stopColor(paint.stops, 1);
    // Keep the focal point inside the circle.
    let fx = paint.fx, fy = paint.fy;
    const fd = Math.hypot(fx - paint.cx, fy - paint.cy);
    if (fd > paint.r * 0.999) { const k = (paint.r * 0.999) / fd; fx = paint.cx + (fx - paint.cx) * k; fy = paint.cy + (fy - paint.cy) * k; }
    const dx = gx - fx, dy = gy - fy;
    const a = dx * dx + dy * dy;
    if (a === 0) return stopColor(paint.stops, 0);
    const ex = fx - paint.cx, ey = fy - paint.cy;
    const b = dx * ex + dy * ey, c = ex * ex + ey * ey - paint.r * paint.r;
    const s = (-b + Math.sqrt(Math.max(0, b * b - a * c))) / a; // ray parameter where it leaves the circle
    return stopColor(paint.stops, 1 / s);
  };
}

function stopColor(stops: GradientStop[], t: number): Rgba {
  const first = stops[0], last = stops[stops.length - 1];
  if (!(t > first.offset)) return first.color;
  if (t >= last.offset) return last.color;
  let i = 0;
  while (stops[i + 1].offset <= t) i++;
  const a = stops[i], b = stops[i + 1];
  const k = (t - a.offset) / (b.offset - a.offset);
  return [0, 1, 2, 3].map((j) => a.color[j] + (b.color[j] - a.color[j]) * k) as Rgba;
}

// ---------------------------------------------------------------- scan conversion

function computeCoverage(polys: Pt[][], evenOdd: boolean, clip: Clip): Coverage | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const poly of polys) for (const [x, y] of poly) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  if (!(minX <= maxX)) return null;
  const x0 = Math.max(Math.floor(clip.x0), Math.floor(minX)), x1 = Math.min(Math.ceil(clip.x1), Math.ceil(maxX));
  const y0 = Math.max(Math.floor(clip.y0), Math.floor(minY)), y1 = Math.min(Math.ceil(clip.y1), Math.ceil(maxY));
  if (x1 <= x0 || y1 <= y0) return null;
  const w = x1 - x0, h = y1 - y0;
  const lines = h * SUBSAMPLES;
  const crossings: { x: number; dir: number }[][] = new Array(lines);
  const lineLo = Math.max(y0 * SUBSAMPLES, Math.ceil(clip.y0 * SUBSAMPLES - 0.5));
  const lineHi = Math.min(y1 * SUBSAMPLES, Math.ceil(clip.y1 * SUBSAMPLES - 0.5));

  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length];
      if (ay === by) continue;
      const dir = ay < by ? 1 : -1;
      const top = Math.min(ay, by), bottom = Math.max(ay, by);
      const jLo = Math.max(lineLo, Math.ceil(top * SUBSAMPLES - 0.5));
      const jHi = Math.min(lineHi, Math.ceil(bottom * SUBSAMPLES - 0.5));
      const slope = (bx - ax) / (by - ay);
      for (let j = jLo; j < jHi; j++) {
        const sy = (j + 0.5) / SUBSAMPLES;
        (crossings[j - y0 * SUBSAMPLES] ??= []).push({ x: ax + (sy - ay) * slope, dir });
      }
    }
  }

  const data = new Float64Array(w * h);
  const weight = 1 / SUBSAMPLES;
  const cx0 = Math.max(clip.x0, x0), cx1 = Math.min(clip.x1, x1);
  for (let line = 0; line < lines; line++) {
    const xs = crossings[line];
    if (!xs) continue;
    xs.sort((p, q) => p.x - q.x);
    const row = Math.floor(line / SUBSAMPLES) * w;
    let wind = 0;
    for (let k = 0; k < xs.length - 1; k++) {
      wind += xs[k].dir;
      const inside = evenOdd ? (k & 1) === 0 : wind !== 0;
      if (!inside) continue;
      const a = Math.max(xs[k].x, cx0), b = Math.min(xs[k + 1].x, cx1);
      if (b > a) addSpan(data, row, a - x0, b - x0, weight);
    }
  }
  return { x0, y0, w, h, data };
}

function addSpan(data: Float64Array, row: number, a: number, b: number, weight: number): void {
  const ia = Math.floor(a), ib = Math.floor(b);
  if (ia === ib) { data[row + ia] += (b - a) * weight; return; }
  data[row + ia] += (ia + 1 - a) * weight;
  for (let x = ia + 1; x < ib; x++) data[row + x] += weight;
  if (b > ib) data[row + ib] += (b - ib) * weight;
}

// ---------------------------------------------------------------- flattening

interface Flat { pts: Pt[]; smooth: boolean[]; closed: boolean }

function flattenSubpath(sp: Subpath, m: Matrix): Flat {
  const pts: Pt[] = [sp.start];
  const smooth: boolean[] = [false];
  let [px, py] = sp.start;
  for (const s of sp.segs) {
    if (s[0] === 'L') { pts.push([s[1], s[2]]); smooth.push(false); px = s[1]; py = s[2]; continue; }
    const [x1, y1, x2, y2, x3, y3] = [s[1], s[2], s[3], s[4], s[5], s[6]];
    const [d0x, d0y] = apply(m, [px, py]), [d1x, d1y] = apply(m, [x1, y1]), [d2x, d2y] = apply(m, [x2, y2]), [d3x, d3y] = apply(m, [x3, y3]);
    const dd = Math.max(Math.hypot(d0x - 2 * d1x + d2x, d0y - 2 * d1y + d2y), Math.hypot(d1x - 2 * d2x + d3x, d1y - 2 * d2y + d3y));
    const n = Math.max(1, Math.min(500, Math.ceil(Math.sqrt((0.75 * dd) / FLATNESS))));
    for (let i = 1; i <= n; i++) {
      const t = i / n, u = 1 - t;
      pts.push(i === n ? [x3, y3] : [
        u * u * u * px + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
        u * u * u * py + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
      ]);
      smooth.push(i !== n);
    }
    px = x3; py = y3;
  }
  return { pts, smooth, closed: sp.closed };
}

// ---------------------------------------------------------------- stroking (in local space)

function strokePolygons(ptsIn: Pt[], smoothIn: boolean[], closed: boolean, shape: SvgShape, deviceScale: number): Pt[][] {
  // Drop repeated points.
  const pts: Pt[] = [], smooth: boolean[] = [];
  for (let i = 0; i < ptsIn.length; i++) {
    const prev = pts[pts.length - 1];
    if (prev && Math.hypot(prev[0] - ptsIn[i][0], prev[1] - ptsIn[i][1]) < 1e-9) continue;
    pts.push(ptsIn[i]); smooth.push(smoothIn[i]);
  }
  if (closed && pts.length > 1 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-9) { pts.pop(); smooth.pop(); }
  const hw = shape.strokeWidth / 2;
  const out: Pt[][] = [];
  const circleAt = (c: Pt) => out.push(circle(c, hw, deviceScale));

  if (pts.length === 1) { // zero-length subpath: only round and square caps draw a dot
    const [x, y] = pts[0];
    if (shape.lineCap === 'round') circleAt(pts[0]);
    else if (shape.lineCap === 'square') out.push(orient([[x - hw, y - hw], [x + hw, y - hw], [x + hw, y + hw], [x - hw, y + hw]]));
    return out;
  }
  if (pts.length < 2) return out;

  const count = closed ? pts.length : pts.length - 1;
  const dirs: Pt[] = [];
  for (let i = 0; i < count; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    dirs.push([(b[0] - a[0]) / len, (b[1] - a[1]) / len]);
    const nx = (-dirs[i][1] * hw), ny = dirs[i][0] * hw;
    out.push(orient([[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]]));
  }

  const joinAt = (v: Pt, d0: Pt, d1: Pt, isSmooth: boolean) => {
    const cross = d0[0] * d1[1] - d0[1] * d1[0], dot = d0[0] * d1[0] + d0[1] * d1[1];
    if (Math.abs(cross) < 1e-12 && dot > 0) return;
    const join = isSmooth ? 'miter' : shape.lineJoin;
    if (join === 'round') { circleAt(v); return; }
    const s = cross > 0 ? -1 : 1;
    const a: Pt = [v[0] + s * hw * -d0[1], v[1] + s * hw * d0[0]];
    const b: Pt = [v[0] + s * hw * -d1[1], v[1] + s * hw * d1[0]];
    if (join === 'miter' && 1 + dot > 1e-12 && 1 / Math.sqrt((1 + dot) / 2) <= MITER_LIMIT) {
      const k = (s * hw) / (1 + dot);
      out.push(orient([v, a, [v[0] + k * (-d0[1] - d1[1]), v[1] + k * (d0[0] + d1[0])], b]));
    } else {
      out.push(orient([v, a, b]));
    }
  };

  if (closed) {
    for (let i = 0; i < pts.length; i++) joinAt(pts[i], dirs[(i + count - 1) % count], dirs[i], smooth[i]);
  } else {
    for (let i = 1; i < pts.length - 1; i++) joinAt(pts[i], dirs[i - 1], dirs[i], smooth[i]);
    const cap = (p: Pt, d: Pt) => { // d points outward from the line end
      if (shape.lineCap === 'round') circleAt(p);
      else if (shape.lineCap === 'square') {
        const nx = -d[1] * hw, ny = d[0] * hw, ex = d[0] * hw, ey = d[1] * hw;
        out.push(orient([[p[0] + nx, p[1] + ny], [p[0] + nx + ex, p[1] + ny + ey], [p[0] - nx + ex, p[1] - ny + ey], [p[0] - nx, p[1] - ny]]));
      }
    };
    cap(pts[0], [-dirs[0][0], -dirs[0][1]]);
    cap(pts[pts.length - 1], dirs[dirs.length - 1]);
  }
  return out;
}

function circle(c: Pt, r: number, deviceScale: number): Pt[] {
  const rd = Math.max(r * deviceScale, FLATNESS * 2);
  const n = Math.max(8, Math.min(256, Math.ceil(Math.PI / Math.acos(1 - FLATNESS / rd))));
  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) pts.push([c[0] + r * Math.cos((2 * Math.PI * i) / n), c[1] + r * Math.sin((2 * Math.PI * i) / n)]);
  return pts;
}

/** Returns the polygon with a positive signed area so overlapping pieces add under nonzero filling. */
function orient(poly: Pt[]): Pt[] {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length];
    area += ax * by - bx * ay;
  }
  return area < 0 ? poly.slice().reverse() : poly;
}
