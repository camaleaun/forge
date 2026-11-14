import { multiply } from './matrix.ts';
import type { Matrix } from './matrix.ts';

// Dependency-free parser for a simple SVG subset. Produces a flat list of shapes whose geometry is
// already normalized to move/line/cubic subpaths in local coordinates plus a transform matrix.

export type { Matrix } from './matrix.ts';
export type Rgba = [number, number, number, number]; // r,g,b 0..255, a 0..1
export type Segment = ['L', number, number] | ['C', number, number, number, number, number, number];
export interface Subpath { start: [number, number]; segs: Segment[]; closed: boolean }
export interface Box { x: number; y: number; width: number; height: number }
export interface GradientStop { offset: number; color: Rgba }
export type Paint =
  | { type: 'none' }
  | { type: 'color'; color: Rgba }
  | { type: 'linear'; units: GradientUnits; x1: number; y1: number; x2: number; y2: number; stops: GradientStop[] }
  | { type: 'radial'; units: GradientUnits; cx: number; cy: number; r: number; fx: number; fy: number; stops: GradientStop[] };
export type GradientUnits = 'objectBoundingBox' | 'userSpaceOnUse';

export interface SvgShape {
  subpaths: Subpath[];
  matrix: Matrix;
  bbox: Box;
  fill: Paint;
  stroke: Paint;
  fillOpacity: number;
  strokeOpacity: number;
  strokeWidth: number;
  lineCap: 'butt' | 'round' | 'square';
  lineJoin: 'miter' | 'round' | 'bevel';
  fillRule: 'nonzero' | 'evenodd';
  opacity: number;
}

export interface SvgDocument { width: number; height: number; viewBox: Box; shapes: SvgShape[] }
export interface ParseOptions { file?: string }

const SUPPORTED_ELEMENTS = ['svg', 'g', 'defs', 'linearGradient', 'radialGradient', 'stop', 'rect', 'circle', 'ellipse', 'path', 'polygon'];
const IGNORED_ELEMENTS = ['title', 'desc'];

// ---------------------------------------------------------------- XML tokenizer

interface Attr { value: string; line: number; col: number }
interface XmlNode { name: string; attrs: Map<string, Attr>; children: XmlNode[]; line: number; col: number }

class SvgError extends Error {}

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[e];
  });
}

function parseXml(src: string, fail: (line: number, col: number, msg: string) => never): XmlNode {
  let pos = 0, line = 1, lineStart = 0;
  const here = () => ({ line, col: pos - lineStart + 1 });
  const advanceTo = (end: number) => {
    for (; pos < end; pos++) if (src[pos] === '\n') { line++; lineStart = pos + 1; }
  };
  const skipPast = (token: string, what: string) => {
    const at = here();
    const i = src.indexOf(token, pos);
    if (i < 0) fail(at.line, at.col, `unterminated ${what}`);
    advanceTo(i + token.length);
  };
  const root: XmlNode = { name: '#document', attrs: new Map(), children: [], line: 1, col: 1 };
  const stack: XmlNode[] = [root];

  while (pos < src.length) {
    const lt = src.indexOf('<', pos);
    if (lt < 0) break;
    advanceTo(lt);
    const at = here();
    if (src.startsWith('<!--', pos)) { skipPast('-->', 'comment'); continue; }
    if (src.startsWith('<![CDATA[', pos)) { skipPast(']]>', 'CDATA section'); continue; }
    if (src.startsWith('<?', pos)) { skipPast('?>', 'processing instruction'); continue; }
    if (src.startsWith('<!', pos)) {
      // DOCTYPE, possibly with an internal subset in [...]
      let depth = 0, i = pos + 2;
      for (; i < src.length; i++) {
        if (src[i] === '[') depth++;
        else if (src[i] === ']') depth--;
        else if (src[i] === '>' && depth <= 0) break;
      }
      if (i >= src.length) fail(at.line, at.col, 'unterminated declaration');
      advanceTo(i + 1);
      continue;
    }
    if (src.startsWith('</', pos)) {
      const m = /^<\/([^\s>]+)\s*>/.exec(src.slice(pos, pos + 256));
      if (!m) fail(at.line, at.col, 'malformed closing tag');
      const top = stack[stack.length - 1];
      if (stack.length === 1 || top.name !== m[1]) fail(at.line, at.col, `mismatched closing tag </${m[1]}>`);
      stack.pop();
      advanceTo(pos + m[0].length);
      continue;
    }
    // Start tag.
    const nameMatch = /^<([^\s/>]+)/.exec(src.slice(pos, pos + 256));
    if (!nameMatch) fail(at.line, at.col, 'malformed tag');
    const node: XmlNode = { name: nameMatch[1], attrs: new Map(), children: [], line: at.line, col: at.col };
    advanceTo(pos + nameMatch[0].length);
    for (;;) {
      const ws = /^\s*/.exec(src.slice(pos, pos + 4096))![0];
      advanceTo(pos + ws.length);
      const p = here();
      if (src.startsWith('/>', pos)) { advanceTo(pos + 2); stack[stack.length - 1].children.push(node); break; }
      if (src[pos] === '>') { advanceTo(pos + 1); stack[stack.length - 1].children.push(node); stack.push(node); break; }
      const am = /^([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/.exec(src.slice(pos, pos + 65536));
      if (!am) fail(p.line, p.col, `malformed attribute in <${node.name}>`);
      node.attrs.set(am[1], { value: decodeEntities(am[3] ?? am[4]), line: p.line, col: p.col });
      advanceTo(pos + am[0].length);
    }
  }
  if (stack.length > 1) {
    const open = stack[stack.length - 1];
    fail(open.line, open.col, `unclosed element <${open.name}>`);
  }
  return root;
}

// ---------------------------------------------------------------- values

const NAMED_COLORS: Record<string, [number, number, number]> = {
  black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0], green: [0, 128, 0], blue: [0, 0, 255],
  lime: [0, 255, 0], yellow: [255, 255, 0], cyan: [0, 255, 255], aqua: [0, 255, 255], magenta: [255, 0, 255],
  fuchsia: [255, 0, 255], gray: [128, 128, 128], grey: [128, 128, 128], silver: [192, 192, 192],
  maroon: [128, 0, 0], olive: [128, 128, 0], navy: [0, 0, 128], purple: [128, 0, 128], teal: [0, 128, 128],
  orange: [255, 165, 0], pink: [255, 192, 203], brown: [165, 42, 42], gold: [255, 215, 0],
  darkgray: [169, 169, 169], darkgrey: [169, 169, 169], lightgray: [211, 211, 211], lightgrey: [211, 211, 211],
  darkred: [139, 0, 0], darkgreen: [0, 100, 0], darkblue: [0, 0, 139], orangered: [255, 69, 0],
  tomato: [255, 99, 71], coral: [255, 127, 80], crimson: [220, 20, 60], indigo: [75, 0, 130],
  violet: [238, 130, 238], skyblue: [135, 206, 235], steelblue: [70, 130, 180], royalblue: [65, 105, 225],
  dodgerblue: [30, 144, 255], slategray: [112, 128, 144], slategrey: [112, 128, 144], whitesmoke: [245, 245, 245],
  ghostwhite: [248, 248, 255], beige: [245, 245, 220], ivory: [255, 255, 240], khaki: [240, 230, 140],
  salmon: [250, 128, 114], turquoise: [64, 224, 208], limegreen: [50, 205, 50], forestgreen: [34, 139, 34],
};

function parseColor(value: string): Rgba | null {
  const v = value.trim().toLowerCase();
  if (v === 'transparent') return [0, 0, 0, 0];
  const named = NAMED_COLORS[v];
  if (named) return [named[0], named[1], named[2], 1];
  let m = /^#([0-9a-f]{3})$/.exec(v);
  if (m) return [...m[1]].map((c) => parseInt(c + c, 16)).concat(1) as Rgba;
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(v);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, m[2] ? parseInt(m[2], 16) / 255 : 1];
  }
  m = /^rgba?\(\s*([^)]*)\)$/.exec(v);
  if (m) {
    const parts = m[1].split(/\s*,\s*|\s+/).filter(Boolean).map(Number);
    if ((parts.length === 3 || parts.length === 4) && parts.every((n) => Number.isFinite(n))) {
      const clamp = (n: number) => Math.max(0, Math.min(255, n));
      return [clamp(parts[0]), clamp(parts[1]), clamp(parts[2]), parts.length === 4 ? Math.max(0, Math.min(1, parts[3])) : 1];
    }
  }
  return null;
}

// ---------------------------------------------------------------- parser

const STYLE_PROPS = new Set(['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap',
  'stroke-linejoin', 'stroke-miterlimit', 'opacity', 'fill-rule', 'stop-color', 'stop-opacity']);
const GEOMETRY_ATTRS: Record<string, string[]> = {
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry'],
  circle: ['cx', 'cy', 'r'],
  ellipse: ['cx', 'cy', 'rx', 'ry'],
  polygon: ['points'],
  path: ['d'],
  g: [],
  svg: ['viewBox', 'width', 'height', 'x', 'y', 'preserveAspectRatio', 'version', 'baseProfile'],
  defs: [],
  linearGradient: ['x1', 'y1', 'x2', 'y2', 'gradientUnits', 'spreadMethod'],
  radialGradient: ['cx', 'cy', 'r', 'fx', 'fy', 'gradientUnits', 'spreadMethod'],
  stop: ['offset'],
};
const SHAPES = ['rect', 'circle', 'ellipse', 'path', 'polygon'];
const IGNORED_ATTR = /^(xmlns(:.*)?|xml:.*|id|class|version|data-.*|aria-.*|role|focusable)$/;

interface Style {
  fill: Paint; stroke: Paint; fillOpacity: number; strokeOpacity: number; strokeWidth: number;
  lineCap: SvgShape['lineCap']; lineJoin: SvgShape['lineJoin']; fillRule: SvgShape['fillRule'];
}
const DEFAULT_STYLE: Style = {
  fill: { type: 'color', color: [0, 0, 0, 1] }, stroke: { type: 'none' }, fillOpacity: 1, strokeOpacity: 1, strokeWidth: 1,
  lineCap: 'butt', lineJoin: 'miter', fillRule: 'nonzero',
};

export function parseSvg(source: string, options: ParseOptions = {}): SvgDocument {
  const file = options.file ?? 'icon.svg';
  const fail = (line: number, col: number, msg: string): never => {
    throw new SvgError(`${file}:${line}:${col}: ${msg}`);
  };
  const failAt = (n: { line: number; col: number }, msg: string): never => fail(n.line, n.col, msg);

  const tree = parseXml(source, fail);
  const rootEl = tree.children[0];
  if (!rootEl) fail(1, 1, 'empty document');
  if (rootEl.name !== 'svg') failAt(rootEl, `root element must be <svg>, found <${rootEl.name}>`);

  const num = (el: XmlNode, name: string, fallback: number): number => {
    const a = el.attrs.get(name);
    if (!a) return fallback;
    const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(px)?\s*$/i.exec(a.value);
    if (!m) return failAt(a, `invalid ${name} "${a.value}" on <${el.name}>`);
    return parseFloat(m[1]);
  };

  // Validate attributes of an element and return its effective property map (attributes, then style).
  const readProps = (el: XmlNode): Map<string, { value: string; line: number; col: number }> => {
    const props = new Map<string, Attr>();
    for (const [name, a] of el.attrs) {
      if (name === 'style') continue;
      if (name === 'transform') {
        if (el.name === 'svg' || el.name === 'defs' || el.name === 'stop' || el.name.endsWith('Gradient')) failAt(a, `unsupported attribute ${name} on <${el.name}>`);
        continue;
      }
      if (STYLE_PROPS.has(name) || GEOMETRY_ATTRS[el.name]?.includes(name) || IGNORED_ATTR.test(name)) {
        if (STYLE_PROPS.has(name)) props.set(name, a);
        continue;
      }
      failAt(a, `unsupported attribute ${name} on <${el.name}>`);
    }
    const style = el.attrs.get('style');
    if (style) {
      for (const decl of style.value.split(';')) {
        if (!decl.trim()) continue;
        const i = decl.indexOf(':');
        const k = decl.slice(0, i).trim();
        if (i < 0 || !STYLE_PROPS.has(k)) failAt(style, `unsupported style property ${i < 0 ? decl.trim() : k} on <${el.name}>`);
        props.set(k, { value: decl.slice(i + 1).trim(), line: style.line, col: style.col });
      }
    }
    return props;
  };

  const viewBox = readViewBox(rootEl);
  function readViewBox(el: XmlNode): Box {
    readProps(el);
    const vb = el.attrs.get('viewBox');
    const w = el.attrs.has('width') ? num(el, 'width', 0) : 0;
    const h = el.attrs.has('height') ? num(el, 'height', 0) : 0;
    if (vb) {
      const n = vb.value.trim().split(/[\s,]+/).map(Number);
      if (n.length !== 4 || n.some((v) => !Number.isFinite(v)) || n[2] <= 0 || n[3] <= 0) failAt(vb, `invalid viewBox "${vb.value}" on <svg>`);
      return { x: n[0], y: n[1], width: n[2], height: n[3] };
    }
    if (!(w > 0 && h > 0)) failAt(el, '<svg> needs a viewBox or width and height');
    return { x: 0, y: 0, width: w, height: h };
  }

  const shapes: SvgShape[] = [];

  const walk = (el: XmlNode, style: Style, opacity: number, matrix: Matrix) => {
    for (const child of el.children) {
      if (IGNORED_ELEMENTS.includes(child.name)) continue;
      if (!SUPPORTED_ELEMENTS.includes(child.name) || child.name === 'svg') {
        failAt(child, `unsupported element <${child.name}> (supported: ${SUPPORTED_ELEMENTS.join(', ')})`);
      }
      if (child.name === 'g') {
        const { style: s, opacity: o } = inherit(child, style, opacity);
        walk(child, s, o, multiply(matrix, readTransform(child)));
      } else if (SHAPES.includes(child.name)) {
        const { style: s, opacity: o } = inherit(child, style, opacity);
        const geom = buildGeometry(child);
        if (geom) shapes.push(makeShape(geom, s, o, multiply(matrix, readTransform(child))));
      } else if (child.name === 'defs') {
        readProps(child);
        for (const d of child.children) {
          if (IGNORED_ELEMENTS.includes(d.name) || d.name === 'linearGradient' || d.name === 'radialGradient') continue;
          if (!SUPPORTED_ELEMENTS.includes(d.name) || d.name === 'svg') {
            failAt(d, `unsupported element <${d.name}> (supported: ${SUPPORTED_ELEMENTS.join(', ')})`);
          }
          // Other known elements inside <defs> are never rendered (no <use>); validate their attributes only.
          readProps(d);
        }
      }
    }
  };

  const inherit = (el: XmlNode, parent: Style, parentOpacity: number): { style: Style; opacity: number } => {
    const props = readProps(el);
    const s: Style = { ...parent };
    let opacity = parentOpacity;
    const unit = (a: Attr, name: string) => {
      const n = Number(a.value);
      if (a.value.trim() === '' || !Number.isFinite(n)) failAt(a, `invalid ${name} "${a.value}" on <${el.name}>`);
      return Math.max(0, Math.min(1, n));
    };
    const oneOf = <T extends string>(a: Attr, name: string, allowed: T[]): T => {
      if (!allowed.includes(a.value as T)) failAt(a, `invalid ${name} "${a.value}" on <${el.name}>`);
      return a.value as T;
    };
    for (const [name, a] of props) {
      switch (name) {
        case 'fill': s.fill = resolvePaint(el, name, a); break;
        case 'stroke': s.stroke = resolvePaint(el, name, a); break;
        case 'fill-opacity': s.fillOpacity = unit(a, name); break;
        case 'stroke-opacity': s.strokeOpacity = unit(a, name); break;
        case 'opacity': opacity *= unit(a, name); break;
        case 'stroke-width': {
          const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+))(px)?\s*$/.exec(a.value);
          if (!m) failAt(a, `invalid stroke-width "${a.value}" on <${el.name}>`);
          s.strokeWidth = parseFloat(m![1]);
          break;
        }
        case 'stroke-linecap': s.lineCap = oneOf(a, name, ['butt', 'round', 'square']); break;
        case 'stroke-linejoin': s.lineJoin = oneOf(a, name, ['miter', 'round', 'bevel']); break;
        case 'fill-rule': s.fillRule = oneOf(a, name, ['nonzero', 'evenodd']); break;
        default: break; // stroke-miterlimit, stop-*: accepted, handled elsewhere
      }
    }
    return { style: s, opacity };
  };

  const resolvePaint = (el: XmlNode, name: string, a: Attr): Paint => {
    const v = a.value.trim();
    if (v === 'none') return { type: 'none' };
    const ref = /^url\(\s*#([^)\s]+)\s*\)$/.exec(v);
    if (ref) {
      const g = gradients.get(ref[1]);
      if (!g) failAt(a, `unknown paint server #${ref[1]} in ${name} on <${el.name}>`);
      return g!;
    }
    const color = parseColor(v);
    if (!color) failAt(a, `invalid ${name} "${a.value}" on <${el.name}>`);
    return { type: 'color', color: color! };
  };

  // Gradients may sit anywhere; collect them all before shapes reference them.
  const gradients = new Map<string, Paint>();
  const percentOrNumber = (el: XmlNode, name: string, fallback: number, units: GradientUnits, base: number): number => {
    const a = el.attrs.get(name);
    if (!a) return fallback;
    const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(%|px)?\s*$/i.exec(a.value);
    if (!m) return failAt(a, `invalid ${name} "${a.value}" on <${el.name}>`);
    const n = parseFloat(m[1]);
    if (m[2] === '%') return units === 'objectBoundingBox' ? n / 100 : (n / 100) * base;
    return n;
  };
  const buildGradient = (el: XmlNode): Paint => {
    readProps(el);
    const spread = el.attrs.get('spreadMethod');
    if (spread && spread.value !== 'pad') failAt(spread, `unsupported spreadMethod "${spread.value}" on <${el.name}>`);
    const unitsAttr = el.attrs.get('gradientUnits');
    if (unitsAttr && unitsAttr.value !== 'objectBoundingBox' && unitsAttr.value !== 'userSpaceOnUse') {
      failAt(unitsAttr, `invalid gradientUnits "${unitsAttr.value}" on <${el.name}>`);
    }
    const units = (unitsAttr?.value ?? 'objectBoundingBox') as GradientUnits;
    const bbox = units === 'objectBoundingBox';
    const w = viewBox.width, h = viewBox.height, d = Math.sqrt((w * w + h * h) / 2);
    const stops: GradientStop[] = [];
    for (const child of el.children) {
      if (IGNORED_ELEMENTS.includes(child.name)) continue;
      if (child.name !== 'stop') failAt(child, `unsupported element <${child.name}> (supported: ${SUPPORTED_ELEMENTS.join(', ')})`);
      const props = readProps(child);
      const off = child.attrs.get('offset');
      let offset = 0;
      if (off) {
        const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+))(%)?\s*$/.exec(off.value);
        if (!m) failAt(off, `invalid offset "${off.value}" on <stop>`);
        offset = parseFloat(m![1]) / (m![2] ? 100 : 1);
      }
      offset = Math.max(stops.length ? stops[stops.length - 1].offset : 0, Math.min(1, Math.max(0, offset)));
      const colorAttr = props.get('stop-color');
      const color: Rgba = colorAttr ? ((parseColor(colorAttr.value) ?? failAt(colorAttr, `invalid stop-color "${colorAttr.value}" on <stop>`)) as Rgba) : [0, 0, 0, 1];
      const opAttr = props.get('stop-opacity');
      const op = opAttr ? Number(opAttr.value) : 1;
      if (!Number.isFinite(op)) failAt(opAttr!, `invalid stop-opacity "${opAttr!.value}" on <stop>`);
      stops.push({ offset, color: [color[0], color[1], color[2], color[3] * Math.max(0, Math.min(1, op))] });
    }
    if (stops.length === 0) return { type: 'none' };
    if (stops.length === 1) return { type: 'color', color: stops[0].color };
    if (el.name === 'linearGradient') {
      return {
        type: 'linear', units, stops,
        x1: percentOrNumber(el, 'x1', 0, units, w), y1: percentOrNumber(el, 'y1', 0, units, h),
        x2: percentOrNumber(el, 'x2', bbox ? 1 : w, units, w), y2: percentOrNumber(el, 'y2', 0, units, h),
      };
    }
    const cx = percentOrNumber(el, 'cx', bbox ? 0.5 : w / 2, units, w);
    const cy = percentOrNumber(el, 'cy', bbox ? 0.5 : h / 2, units, h);
    return {
      type: 'radial', units, stops, cx, cy, r: percentOrNumber(el, 'r', bbox ? 0.5 : d / 2, units, d),
      fx: percentOrNumber(el, 'fx', cx, units, w), fy: percentOrNumber(el, 'fy', cy, units, h),
    };
  };
  const collectGradients = (el: XmlNode) => {
    for (const child of el.children) {
      if (child.name === 'linearGradient' || child.name === 'radialGradient') {
        const id = child.attrs.get('id');
        const paint = buildGradient(child);
        if (id) gradients.set(id.value, paint);
      } else {
        collectGradients(child);
      }
    }
  };
  collectGradients(rootEl);

  const buildGeometry = (el: XmlNode): { subpaths: Subpath[]; bbox: Box } | null => {
    const subpaths = shapeSubpaths(el);
    if (!subpaths || subpaths.length === 0) return null;
    return { subpaths, bbox: boundsOf(subpaths) };
  };

  const shapeSubpaths = (el: XmlNode): Subpath[] | null => {
    switch (el.name) {
      case 'rect': {
        const x = num(el, 'x', 0), y = num(el, 'y', 0), w = num(el, 'width', 0), h = num(el, 'height', 0);
        if (!(w > 0 && h > 0)) return null;
        let rx = el.attrs.has('rx') ? num(el, 'rx', 0) : NaN;
        let ry = el.attrs.has('ry') ? num(el, 'ry', 0) : NaN;
        if (Number.isNaN(rx)) rx = Number.isNaN(ry) ? 0 : ry;
        if (Number.isNaN(ry)) ry = rx;
        rx = Math.min(rx, w / 2); ry = Math.min(ry, h / 2);
        return [roundedRect(x, y, w, h, rx, ry)];
      }
      case 'circle': {
        const r = num(el, 'r', 0);
        return r > 0 ? [ellipsePath(num(el, 'cx', 0), num(el, 'cy', 0), r, r)] : null;
      }
      case 'ellipse': {
        const rx = num(el, 'rx', 0), ry = num(el, 'ry', 0);
        return rx > 0 && ry > 0 ? [ellipsePath(num(el, 'cx', 0), num(el, 'cy', 0), rx, ry)] : null;
      }
      case 'path': {
        const a = el.attrs.get('d');
        if (!a) return null;
        return parsePath(a.value, (msg) => failAt(a, msg));
      }
      case 'polygon': {
        const a = el.attrs.get('points');
        const n = (a?.value ?? '').trim().split(/[\s,]+/).filter(Boolean).map(Number);
        if (n.some((v) => !Number.isFinite(v)) || n.length % 2 !== 0) failAt(a ?? el, `invalid points "${a?.value ?? ''}" on <polygon>`);
        if (n.length < 4) return null;
        const segs: Segment[] = [];
        for (let i = 2; i < n.length; i += 2) segs.push(['L', n[i], n[i + 1]]);
        return [{ start: [n[0], n[1]], segs, closed: true }];
      }
      default:
        return null;
    }
  };

  const readTransform = (el: XmlNode): Matrix => {
    const a = el.attrs.get('transform');
    return a ? parseTransform(a.value, (msg) => failAt(a, msg), el.name) : [1, 0, 0, 1, 0, 0];
  };

  const makeShape = (geom: { subpaths: Subpath[]; bbox: Box }, s: Style, opacity: number, matrix: Matrix): SvgShape => {
    return {
      subpaths: geom.subpaths, matrix, bbox: geom.bbox,
      fill: s.fill, stroke: s.stroke, fillOpacity: s.fillOpacity, strokeOpacity: s.strokeOpacity,
      strokeWidth: s.strokeWidth, lineCap: s.lineCap, lineJoin: s.lineJoin, fillRule: s.fillRule, opacity,
    };
  };

  const { style: rootStyle, opacity: rootOpacity } = inherit(rootEl, DEFAULT_STYLE, 1);
  walk(rootEl, rootStyle, rootOpacity, [1, 0, 0, 1, 0, 0]);

  return { width: viewBox.width, height: viewBox.height, viewBox, shapes };
}

// ---------------------------------------------------------------- geometry helpers

const KAPPA = 0.5522847498307936;

function ellipsePath(cx: number, cy: number, rx: number, ry: number): Subpath {
  const kx = rx * KAPPA, ky = ry * KAPPA;
  return {
    start: [cx + rx, cy], closed: true,
    segs: [
      ['C', cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry],
      ['C', cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy],
      ['C', cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry],
      ['C', cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy],
    ],
  };
}

function roundedRect(x: number, y: number, w: number, h: number, rx: number, ry: number): Subpath {
  if (rx <= 0 || ry <= 0) {
    return { start: [x, y], closed: true, segs: [['L', x + w, y], ['L', x + w, y + h], ['L', x, y + h]] };
  }
  const kx = rx * KAPPA, ky = ry * KAPPA;
  const r = x + w, b = y + h;
  const segs: Segment[] = [];
  const line = (px: number, py: number) => { segs.push(['L', px, py]); };
  line(r - rx, y);
  segs.push(['C', r - rx + kx, y, r, y + ry - ky, r, y + ry]);
  line(r, b - ry);
  segs.push(['C', r, b - ry + ky, r - rx + kx, b, r - rx, b]);
  line(x + rx, b);
  segs.push(['C', x + rx - kx, b, x, b - ry + ky, x, b - ry]);
  line(x, y + ry);
  segs.push(['C', x, y + ry - ky, x + rx - kx, y, x + rx, y]);
  return { start: [x + rx, y], closed: true, segs: segs.filter((s, i) => !(s[0] === 'L' && i === segs.length - 1 && false)) };
}

function boundsOf(subpaths: Subpath[]): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x: number, y: number) => {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  };
  for (const sp of subpaths) {
    let [px, py] = sp.start;
    add(px, py);
    for (const s of sp.segs) {
      if (s[0] === 'L') { add(s[1], s[2]); px = s[1]; py = s[2]; continue; }
      for (let i = 1; i <= 16; i++) {
        const t = i / 16, u = 1 - t;
        add(u * u * u * px + 3 * u * u * t * s[1] + 3 * u * t * t * s[3] + t * t * t * s[5],
          u * u * u * py + 3 * u * u * t * s[2] + 3 * u * t * t * s[4] + t * t * t * s[6]);
      }
      px = s[5]; py = s[6];
    }
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

// ---------------------------------------------------------------- transforms

function parseTransform(value: string, fail: (msg: string) => never, elName: string): Matrix {
  const invalid = () => fail(`invalid transform "${value}" on <${elName}>`);
  const re = /\s*([a-zA-Z]+)\s*\(([^)]*)\)\s*,?/y;
  let result: Matrix = [1, 0, 0, 1, 0, 0];
  let pos = 0;
  const text = value.trim();
  if (text === '') return result;
  while (pos < text.length) {
    re.lastIndex = pos;
    const m = re.exec(text);
    if (!m) return invalid();
    pos = re.lastIndex;
    const args = m[2].trim().split(/[\s,]+/).filter(Boolean).map(Number);
    if (args.some((n) => !Number.isFinite(n))) return invalid();
    const [a = 0, b, c, d, e, f] = args;
    let t: Matrix;
    switch (m[1]) {
      case 'translate': if (args.length < 1 || args.length > 2) return invalid(); t = [1, 0, 0, 1, a, b ?? 0]; break;
      case 'scale': if (args.length < 1 || args.length > 2) return invalid(); t = [a, 0, 0, b ?? a, 0, 0]; break;
      case 'rotate': {
        if (args.length !== 1 && args.length !== 3) return invalid();
        const r = (a * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
        const rot: Matrix = [cos, sin, -sin, cos, 0, 0];
        t = args.length === 3 ? multiply(multiply([1, 0, 0, 1, b!, c!], rot), [1, 0, 0, 1, -b!, -c!]) : rot;
        break;
      }
      case 'matrix': if (args.length !== 6) return invalid(); t = [a, b!, c!, d!, e!, f!]; break;
      default: return fail(`unsupported transform function ${m[1]} on <${elName}> (supported: translate, scale, rotate, matrix)`);
    }
    result = multiply(result, t);
  }
  return result;
}

// ---------------------------------------------------------------- path data

const ARG_COUNT: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

function parsePath(d: string, fail: (msg: string) => never): Subpath[] {
  const bad = () => fail(`invalid path data in d="${d}"`);
  const numRe = /[\s,]*([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/y;
  const flagRe = /[\s,]*([01])/y;
  let i = 0;
  const readNum = (): number => {
    numRe.lastIndex = i;
    const m = numRe.exec(d);
    if (!m) return bad();
    i = numRe.lastIndex;
    return parseFloat(m[1]);
  };
  const readFlag = (): number => {
    flagRe.lastIndex = i;
    const m = flagRe.exec(d);
    if (!m) return bad();
    i = flagRe.lastIndex;
    return Number(m[1]);
  };
  const skipWs = () => { while (i < d.length && /[\s,]/.test(d[i])) i++; };
  const nextIsNumber = () => { skipWs(); return i < d.length && /[+\-.\d]/.test(d[i]); };

  const out: Subpath[] = [];
  let cur: Subpath | null = null;
  let cx = 0, cy = 0, sx = 0, sy = 0;
  let lastCubic: [number, number] | null = null; // second control of previous C/S
  let lastQuad: [number, number] | null = null; // control of previous Q/T
  const finish = () => { if (cur && cur.segs.length > 0) out.push(cur); cur = null; };
  const ensure = (): Subpath => (cur ??= { start: [cx, cy], segs: [], closed: false });

  skipWs();
  if (i >= d.length) return out;
  let cmd = '';
  let first = true;
  while (i < d.length) {
    skipWs();
    if (i >= d.length) break;
    if (/[a-zA-Z]/.test(d[i])) {
      cmd = d[i++];
      if (!(cmd.toUpperCase() in ARG_COUNT)) fail(`unsupported path command ${cmd} in d="${d}"`);
    } else if (!cmd || cmd.toUpperCase() === 'Z') {
      bad();
    }
    if (first && cmd !== 'M' && cmd !== 'm') bad();
    first = false;
    const up = cmd.toUpperCase();
    const rel = cmd !== up;
    const n = ARG_COUNT[up];
    if (up === 'Z') {
      if (cur) { cur.closed = true; finish(); }
      cx = sx; cy = sy;
      lastCubic = lastQuad = null;
      continue;
    }
    // One or more argument groups for the same command letter.
    let firstGroup = true;
    do {
      const ox = rel ? cx : 0, oy = rel ? cy : 0;
      let prevCubic = lastCubic, prevQuad = lastQuad;
      lastCubic = lastQuad = null;
      if (up === 'M') {
        const x = readNum() + ox, y = readNum() + oy;
        if (firstGroup) {
          finish();
          cx = sx = x; cy = sy = y;
        } else {
          ensure().segs.push(['L', x, y]);
          cx = x; cy = y;
        }
      } else if (up === 'L') { const x = readNum() + ox, y = readNum() + oy; ensure().segs.push(['L', x, y]); cx = x; cy = y; }
      else if (up === 'H') { const x = readNum() + ox; ensure().segs.push(['L', x, cy]); cx = x; }
      else if (up === 'V') { const y = readNum() + oy; ensure().segs.push(['L', cx, y]); cy = y; }
      else if (up === 'C' || up === 'S') {
        let x1: number, y1: number;
        if (up === 'C') { x1 = readNum() + ox; y1 = readNum() + oy; }
        else if (prevCubic) { x1 = 2 * cx - prevCubic[0]; y1 = 2 * cy - prevCubic[1]; }
        else { x1 = cx; y1 = cy; }
        const x2 = readNum() + ox, y2 = readNum() + oy, x = readNum() + ox, y = readNum() + oy;
        ensure().segs.push(['C', x1, y1, x2, y2, x, y]);
        lastCubic = [x2, y2]; cx = x; cy = y;
      } else if (up === 'Q' || up === 'T') {
        let qx: number, qy: number;
        if (up === 'Q') { qx = readNum() + ox; qy = readNum() + oy; }
        else if (prevQuad) { qx = 2 * cx - prevQuad[0]; qy = 2 * cy - prevQuad[1]; }
        else { qx = cx; qy = cy; }
        const x = readNum() + ox, y = readNum() + oy;
        ensure().segs.push(['C', cx + (2 / 3) * (qx - cx), cy + (2 / 3) * (qy - cy), x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), x, y]);
        lastQuad = [qx, qy]; cx = x; cy = y;
      } else { // A
        const rx = readNum(), ry = readNum(), rot = readNum(), large = readFlag(), sweep = readFlag();
        const x = readNum() + ox, y = readNum() + oy;
        const sp = ensure();
        arcToCubics(cx, cy, rx, ry, rot, large === 1, sweep === 1, x, y, sp.segs);
        cx = x; cy = y;
      }
      firstGroup = false;
    } while (n > 0 && nextIsNumber());
  }
  finish();
  return out;
}

// SVG spec F.6: endpoint arc to center parameterization, then <= 90 degree cubic pieces.
function arcToCubics(x0: number, y0: number, rxIn: number, ryIn: number, rotDeg: number, large: boolean, sweep: boolean, x: number, y: number, segs: Segment[]): void {
  let rx = Math.abs(rxIn), ry = Math.abs(ryIn);
  if (x0 === x && y0 === y) return;
  if (rx === 0 || ry === 0) { segs.push(['L', x, y]); return; }
  const phi = (rotDeg * Math.PI) / 180, cosP = Math.cos(phi), sinP = Math.sin(phi);
  const dx = (x0 - x) / 2, dy = (y0 - y) / 2;
  const x1p = cosP * dx + sinP * dy, y1p = -sinP * dx + cosP * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) { const s = Math.sqrt(lambda); rx *= s; ry *= s; }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coef = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = (coef * rx * y1p) / ry, cyp = (-coef * ry * x1p) / rx;
  const cx = cosP * cxp - sinP * cyp + (x0 + x) / 2, cy = sinP * cxp + cosP * cyp + (y0 + y) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dTheta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
  else if (sweep && dTheta < 0) dTheta += 2 * Math.PI;
  const pieces = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 2) - 1e-9));
  const delta = dTheta / pieces;
  const k = (4 / 3) * Math.tan(delta / 4);
  const point = (t: number): [number, number, number, number] => {
    const c = Math.cos(t), s = Math.sin(t);
    return [cosP * rx * c - sinP * ry * s + cx, sinP * rx * c + cosP * ry * s + cy,
      -cosP * rx * s - sinP * ry * c, -sinP * rx * s + cosP * ry * c];
  };
  let t = theta1;
  for (let i = 0; i < pieces; i++) {
    const [ax, ay, adx, ady] = point(t);
    const [bx, by, bdx, bdy] = point(t + delta);
    const ex = i === pieces - 1 ? x : bx, ey = i === pieces - 1 ? y : by;
    segs.push(['C', ax + k * adx, ay + k * ady, bx - k * bdx, by - k * bdy, ex, ey]);
    t += delta;
  }
}
