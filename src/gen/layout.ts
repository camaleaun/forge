import type { Binding, MediaQuery, Node, Style, TextValue } from '../ir/types.ts';
import { languageName } from '../i18n/names.ts';
import type { I18nGenOptions } from './i18n-options.ts';

// A platform-neutral reading of the IR: every flexbox-like decision is made here once,
// and the macOS and Linux generators only translate it into toolkit calls.
export type Align = 'start' | 'center' | 'end' | 'stretch';
export type Justify = 'start' | 'center' | 'end' | 'space-between';
export type Padding = [top: number, right: number, bottom: number, left: number];

export type Paint = {
  color?: string;       // text color, '#rrggbbaa'
  background?: string;  // '#rrggbbaa'
  radius?: number;
  fontSize?: number;
  fontWeight?: number;
  textAlign?: string;
};

// What an @media variant can change, in layout terms. A width or height of AUTO (-1) means "no fixed size".
export const AUTO = -1;
export type Changes = Partial<{ horizontal: boolean; gap: number; padding: Padding; width: number; height: number; grow: boolean } & Paint>;
export type LayoutVariant = { query: MediaQuery; set: Changes };

export type LayoutNode = {
  id: string;
  role?: 'steps' | 'step';  // <steps> has no visual of its own; each <step> is a screen
  step?: Node['step'];      // the window size of a screen
  disabledDuringDownload?: boolean;
  kind: 'box' | 'text' | 'button' | 'select' | 'progress';
  title?: TextValue;      // the window title (root only)
  horizontal: boolean;    // main axis of the box
  gap: number;
  padding: Padding;
  align: Align;           // cross-axis alignment of the children
  justify: Justify;       // main-axis distribution of the children
  width?: number;         // fixed size
  height?: number;
  grow: boolean;          // flex > 0: takes the free space of the parent's main axis
  // Set when the parent stretches this child across and it has no cross size of its own:
  // the child fills the parent's cross axis minus this padding inset.
  stretchInset?: number;
  paint: Paint;
  content?: Binding;      // text and button content
  handler?: string;       // button click handler
  languages?: [string, string][]; // select: [tag, endonym] choices
  progress?: Node['progress'];    // progress: value/max, indeterminate or source (passed through)
  variants?: LayoutVariant[];     // @media variants in cascade order (a later one wins)
  children: LayoutNode[];
};

const num = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined);
const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

const ALIGN: Align[] = ['start', 'center', 'end', 'stretch'];
const JUSTIFY: Justify[] = ['start', 'center', 'end', 'space-between'];

function paintOf(node: Node): Paint {
  const { style } = node;
  const paint: Paint = {};
  const color = str(style.color);
  const background = str(style.background);
  const radius = num(style.borderRadius);
  const fontSize = num(style.fontSize);
  const fontWeight = num(style.fontWeight);
  const textAlign = str(style.textAlign);
  if (color !== undefined) paint.color = color;
  if (background !== undefined) paint.background = background;
  if (radius !== undefined) paint.radius = radius;
  if (fontSize !== undefined) paint.fontSize = fontSize;
  if (fontWeight !== undefined) paint.fontWeight = fontWeight;
  if (textAlign !== undefined) paint.textAlign = textAlign;
  return paint;
}

function changesOf(style: Style): Changes {
  const set: Changes = {};
  if (style.flexDirection !== undefined) set.horizontal = style.flexDirection === 'row';
  const gap = num(style.gap);
  if (gap !== undefined) set.gap = gap;
  if (Array.isArray(style.padding)) set.padding = style.padding as Padding;
  if (style.width !== undefined) set.width = num(style.width) ?? AUTO;
  if (style.height !== undefined) set.height = num(style.height) ?? AUTO;
  const flex = num(style.flex);
  if (flex !== undefined) set.grow = flex > 0;
  const { color, background, radius, fontSize, fontWeight, textAlign } = paintOf({ style } as Node);
  if (color !== undefined) set.color = color;
  if (background !== undefined) set.background = background;
  if (radius !== undefined) set.radius = radius;
  if (fontSize !== undefined) set.fontSize = fontSize;
  if (fontWeight !== undefined) set.fontWeight = fontWeight;
  if (textAlign !== undefined) set.textAlign = textAlign;
  return set;
}

// Does some @media variant of the node set `key`?
export function varies(node: LayoutNode, key: keyof Changes): boolean {
  return (node.variants ?? []).some((variant) => key in variant.set);
}

// The C++ condition that tells whether a window of `w` by `h` matches the query.
export function queryCondition(query: MediaQuery, w: string, h: string): string {
  const parts: string[] = [];
  if (query.minWidth !== undefined) parts.push(`${w} >= ${query.minWidth}`);
  if (query.maxWidth !== undefined) parts.push(`${w} <= ${query.maxWidth}`);
  if (query.minHeight !== undefined) parts.push(`${h} >= ${query.minHeight}`);
  if (query.maxHeight !== undefined) parts.push(`${h} <= ${query.maxHeight}`);
  return parts.join(' && ');
}

// A C++ expression for the value of `key` at the current window size: the base, overridden by each variant that
// sets it, later variants last (so they win). `valueOf` turns a variant value into a C++ expression.
export function effective<K extends keyof Changes>(
  node: LayoutNode,
  key: K,
  base: string,
  valueOf: (value: NonNullable<Changes[K]>) => string,
  w = 'w',
  h = 'h',
): string {
  let expr = base;
  for (const variant of node.variants ?? []) {
    const value = variant.set[key];
    if (value !== undefined) expr = `(${queryCondition(variant.query, w, h)} ? ${valueOf(value as NonNullable<Changes[K]>)} : ${expr})`;
  }
  return expr;
}

// English first, then the endonym of every pack (no "Auto": the dropdown shows the language in use).
export function languageChoices(i18n: I18nGenOptions | undefined): [string, string][] {
  return [['en', 'English'], ...(i18n?.packs ?? []).map((pack): [string, string] => [pack.tag, languageName(pack.tag)])];
}

function build(node: Node, parent: LayoutNode | undefined, languages: [string, string][] | undefined): LayoutNode {
  const { style } = node;
  const kind = node.kind === 'window' || node.kind === 'view' || node.kind === 'steps' || node.kind === 'step' ? 'box' : node.kind;
  const align = ALIGN.find((value) => value === style.alignItems) ?? 'stretch';
  const result: LayoutNode = {
    id: node.id,
    kind,
    horizontal: style.flexDirection === 'row',
    gap: num(style.gap) ?? 0,
    padding: (style.padding as Padding | undefined) ?? [0, 0, 0, 0],
    align,
    justify: JUSTIFY.find((value) => value === style.justifyContent) ?? 'start',
    grow: (num(style.flex) ?? 0) > 0,
    paint: paintOf(node),
    children: [],
  };
  if (node.title !== undefined) result.title = node.title;
  const width = num(style.width);
  const height = num(style.height);
  if (width !== undefined) result.width = width;
  if (height !== undefined) result.height = height;
  if (node.content !== undefined) result.content = node.content;
  if (node.on?.click !== undefined) result.handler = node.on.click;
  if (node.kind === 'steps' || node.kind === 'step') result.role = node.kind;
  if (node.step !== undefined) result.step = node.step;
  // The screens fill the window, so a footer (a last child after a growing one) sits at the bottom edge.
  if (result.role !== undefined) result.grow = true;
  if (node.disabledDuringDownload) result.disabledDuringDownload = true;
  if (node.progress !== undefined) result.progress = node.progress;
  if (node.variants) result.variants = node.variants.map((variant) => ({ query: variant.query, set: changesOf(variant.style) }));
  if (kind === 'select') result.languages = languages ?? [];
  if (parent && parent.align === 'stretch') {
    const crossSize = parent.horizontal ? result.height : result.width;
    if (crossSize === undefined) {
      const [top, right, bottom, left] = parent.padding;
      result.stretchInset = parent.horizontal ? top + bottom : left + right;
    }
  }
  result.children = node.children.map((child) => build(child, result, languages));
  return result;
}

export function layoutOf(root: Node, languages?: [string, string][]): LayoutNode {
  return build(root, undefined, languages);
}

// A bar that follows the language download needs the loader, which only apps with language packs have.
export function checkProgressSources(root: Node, hasLanguagePacks: boolean): void {
  const visit = (node: Node): void => {
    if (node.progress?.source === 'language-download' && !hasLanguagePacks) {
      throw new Error('<progress source="language-download"> needs at least one language pack');
    }
    node.children.forEach(visit);
  };
  visit(root);
}
