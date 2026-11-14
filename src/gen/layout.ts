import type { Binding, Node, TextValue } from '../ir/types.ts';
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

export type LayoutNode = {
  id: string;
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

// English first, then the endonym of every pack (no "Auto": the dropdown shows the language in use).
export function languageChoices(i18n: I18nGenOptions | undefined): [string, string][] {
  return [['en', 'English'], ...(i18n?.packs ?? []).map((pack): [string, string] => [pack.tag, languageName(pack.tag)])];
}

function build(node: Node, parent: LayoutNode | undefined, languages: [string, string][] | undefined): LayoutNode {
  const { style } = node;
  const kind = node.kind === 'window' || node.kind === 'view' ? 'box' : node.kind;
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
  if (node.progress !== undefined) result.progress = node.progress;
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
