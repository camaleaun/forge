import { ELEMENT_KINDS, PROPERTIES } from './properties.ts';
import type { StyleValue } from './properties.ts';

export type { StyleValue };
export type Loc = [line: number, column: number];
export type Selector = { kind: 'type' | 'class' | 'id'; name: string; loc: Loc };
export type Declaration = { property: string; value: StyleValue; loc: Loc };
export type Rule = { selectors: Selector[]; declarations: Declaration[]; order: number };

/** Replaces comments with spaces (newlines kept) so offsets and positions stay valid. */
function blankComments(source: string, onUnterminated: (offset: number) => void): string {
  return source.replace(/\/\*[\s\S]*?(\*\/|$)/g, (comment, end: string, offset: number) => {
    if (!end) onUnterminated(offset);
    return comment.replace(/[^\n]/g, ' ');
  });
}

export function parseCss(original: string, file: string): { rules: Rule[]; errors: string[] } {
  const rules: Rule[] = [];
  const found: { offset: number; message: string }[] = [];
  const locOf = (offset: number): Loc => {
    const before = original.slice(0, offset);
    const line = before.split('\n').length;
    return [line, offset - (before.lastIndexOf('\n') + 1) + 1];
  };
  const fail = (offset: number, message: string) => {
    found.push({ offset, message });
  };
  const source = blankComments(original, (offset) => fail(offset, 'unterminated comment'));

  let pos = 0;
  while (pos < source.length) {
    const atRule = /^\s*(@[\w-]+)/.exec(source.slice(pos));
    if (atRule) {
      fail(pos + atRule[0].length - atRule[1].length, `unsupported at-rule "${atRule[1]}" in v1`);
      pos = endOfAtRule(source, pos);
      continue;
    }
    const open = source.indexOf('{', pos);
    if (open < 0) break;
    const close = source.indexOf('}', open);
    if (close < 0) {
      fail(open, 'unclosed block, expected "}"');
      break;
    }
    const selectors: Selector[] = [];
    for (const part of splitWithOffsets(source.slice(pos, open), ',', pos)) {
      const text = part.text.trim();
      const at = part.offset + part.text.indexOf(text);
      const m = /^([.#]?)([A-Za-z_][\w-]*)$/.exec(text);
      if (!m) {
        const why = text.includes(':') ? 'pseudo-classes' : 'combinators';
        fail(at, `unsupported selector "${text}": ${why} are not supported in v1`);
        continue;
      }
      if (!m[1] && !(ELEMENT_KINDS as readonly string[]).includes(m[2])) {
        fail(at, `unknown element selector "${m[2]}"`);
        continue;
      }
      selectors.push({ kind: m[1] === '.' ? 'class' : m[1] === '#' ? 'id' : 'type', name: m[2], loc: locOf(at) });
    }
    const declarations: Declaration[] = [];
    const body = source.slice(open + 1, close);
    for (const part of splitWithOffsets(body, ';', open + 1)) {
      const colon = part.text.indexOf(':');
      if (colon < 0) {
        const text = part.text.trim();
        if (text) fail(part.offset + part.text.indexOf(text), `expected ":" in declaration "${text}"`);
        continue;
      }
      const property = part.text.slice(0, colon).trim();
      const propertyAt = part.offset + part.text.indexOf(property);
      const afterColon = part.text.slice(colon + 1);
      const raw = afterColon.trim();
      const valueAt = part.offset + colon + 1 + (afterColon.length - afterColon.trimStart().length);
      if (/!\s*important\s*$/i.test(raw)) {
        fail(valueAt, '"!important" is not supported in v1');
        continue;
      }
      const spec = PROPERTIES[property];
      if (!spec) {
        fail(propertyAt, `unknown property "${property}" (supported: ${Object.keys(PROPERTIES).join(', ')})`);
        continue;
      }
      const value = spec.parse(raw);
      if (value === undefined) {
        fail(valueAt, `invalid value "${raw}" for "${property}": expected ${spec.expected}`);
        continue;
      }
      declarations.push({ property, value, loc: locOf(propertyAt) });
    }
    rules.push({ selectors, declarations, order: rules.length });
    pos = close + 1;
  }
  const errors = found
    .sort((a, b) => a.offset - b.offset)
    .map(({ offset, message }) => `${file}:${locOf(offset).join(':')}: ${message}`);
  return { rules, errors };
}

function splitWithOffsets(text: string, separator: string, base: number): { text: string; offset: number }[] {
  const parts: { text: string; offset: number }[] = [];
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    if (i === text.length || text[i] === separator) {
      parts.push({ text: text.slice(start, i), offset: base + start });
      start = i + 1;
    }
  }
  return parts;
}

/** Offset just after the block or statement that an @-rule starting at `from` spans. */
function endOfAtRule(source: string, from: number): number {
  let depth = 0;
  for (let i = from; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return i + 1;
    else if (source[i] === ';' && depth === 0) return i + 1;
  }
  return source.length;
}
