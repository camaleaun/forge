export const ELEMENT_KINDS = ['window', 'view', 'steps', 'step', 'text', 'button', 'select', 'progress'] as const;
export type ElementKind = (typeof ELEMENT_KINDS)[number];
export type StyleValue = number | string | number[];

export type PropertySpec = {
  kinds: ElementKind[];
  /** Human description of the accepted grammar, used in "invalid value" errors. */
  expected: string;
  /** Returns the normalized value, or undefined when the raw text is not valid. */
  parse: (raw: string) => StyleValue | undefined;
};

export function parsePx(raw: string): number | undefined {
  if (raw === '0') return 0;
  const m = /^(\d+(?:\.\d+)?)px$/.exec(raw);
  return m ? Number(m[1]) : undefined;
}

export function parsePadding(raw: string): number[] | undefined {
  const parts = raw.split(/\s+/).map(parsePx);
  if (parts.length < 1 || parts.length > 4 || parts.some((p) => p === undefined)) return undefined;
  const [t, r = t, b = t, l = r] = parts as number[];
  return [t, r, b, l];
}

export function parseColor(raw: string): string | undefined {
  const text = raw.toLowerCase();
  if (text === 'transparent') return '#00000000';
  const m = /^#([0-9a-f]+)$/.exec(text);
  if (!m) return undefined;
  const hex = m[1];
  if (hex.length === 3) return '#' + [...hex].map((c) => c + c).join('') + 'ff';
  if (hex.length === 6) return '#' + hex + 'ff';
  if (hex.length === 8) return '#' + hex;
  return undefined;
}

function keywords(...words: string[]): Pick<PropertySpec, 'expected' | 'parse'> {
  return { expected: words.join(' | '), parse: (raw) => (words.includes(raw) ? raw : undefined) };
}

const px = { expected: 'px', parse: parsePx };
const pxOrAuto = {
  expected: 'px | auto',
  parse: (raw: string) => (raw === 'auto' ? 'auto' : parsePx(raw)),
};
const grow = {
  expected: 'number',
  parse: (raw: string) => (/^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : undefined),
};
const fontWeight = {
  expected: 'normal | bold | 400 | 700',
  parse: (raw: string) => ({ normal: 400, bold: 700, '400': 400, '700': 700 })[raw as 'normal'],
};
const color = {
  expected: 'color (#rgb, #rrggbb, #rrggbbaa or transparent)',
  parse: parseColor,
};

const BOX: ElementKind[] = ['window', 'view', 'step'];
const SIZE: ElementKind[] = ['window', 'view', 'text', 'button', 'select', 'progress'];
const TEXT: ElementKind[] = ['text'];
const TEXT_AND_BUTTON: ElementKind[] = ['text', 'button', 'select'];

export const PROPERTIES: Record<string, PropertySpec> = {
  'flex-direction': { kinds: BOX, ...keywords('row', 'column') },
  gap: { kinds: BOX, ...px },
  padding: { kinds: BOX, expected: 'px', parse: parsePadding },
  'align-items': { kinds: BOX, ...keywords('start', 'center', 'end', 'stretch') },
  'justify-content': { kinds: BOX, ...keywords('start', 'center', 'end', 'space-between') },
  width: { kinds: SIZE, ...pxOrAuto },
  height: { kinds: SIZE, ...pxOrAuto },
  flex: { kinds: SIZE, ...grow },
  background: { kinds: BOX, ...color },
  'border-radius': { kinds: BOX, ...px },
  color: { kinds: ['text', 'progress'], ...color },
  'font-size': { kinds: TEXT_AND_BUTTON, ...px },
  'font-weight': { kinds: TEXT_AND_BUTTON, ...fontWeight },
  'text-align': { kinds: TEXT, ...keywords('left', 'center', 'right') },
};
