import { ELEMENT_KINDS, PROPERTIES, parsePx } from './properties.ts';
import type { StyleValue } from './properties.ts';
import { TARGET_LIST, isTarget } from '../ir/targets.ts';
import type { Target } from '../ir/targets.ts';
import type { MediaQuery } from '../ir/types.ts';

export type { StyleValue };
export type Loc = [line: number, column: number];
export type Selector = { kind: 'type' | 'class' | 'id'; name: string; loc: Loc };
export type Declaration = { property: string; value: StyleValue; loc: Loc };
// Conditions a rule sits under: a target (@only/@except) or a window size (@media), in nesting order.
export type Condition = { kind: 'target'; mode: 'only' | 'except'; targets: Target[] } | { kind: 'media'; query: MediaQuery };
export type Rule = { selectors: Selector[]; declarations: Declaration[]; order: number; conditions?: Condition[] };

/** Replaces comments with spaces (newlines kept) so offsets and positions stay valid. */
function blankComments(source: string, onUnterminated: (offset: number) => void): string {
  return source.replace(/\/\*[\s\S]*?(\*\/|$)/g, (comment, end: string, offset: number) => {
    if (!end) onUnterminated(offset);
    return comment.replace(/[^\n]/g, ' ');
  });
}

// One entry per supported at-rule. `condition` parses the prelude (the text between the name and "{")
// into a Condition and reports its own errors. An at-rule cannot sit inside one of its own kind.
type AtRule = { kind: Condition['kind']; condition: (prelude: string, preludeAt: number, at: number, fail: (offset: number, message: string) => void) => Condition | undefined };

function targetRule(mode: 'only' | 'except'): AtRule {
  return {
    kind: 'target',
    condition: (prelude, preludeAt, at, fail) => {
      const names = [...prelude.matchAll(/\S+/g)];
      if (names.length === 0) {
        fail(at, `@${mode} needs at least one target (${TARGET_LIST})`);
        return undefined;
      }
      const targets: Target[] = [];
      let valid = true;
      for (const name of names) {
        if (isTarget(name[0])) targets.push(name[0]);
        else {
          fail(preludeAt + name.index, `unknown target "${name[0]}" in @${mode} (expected ${TARGET_LIST})`);
          valid = false;
        }
      }
      return valid ? { kind: 'target', mode, targets } : undefined;
    },
  };
}

const MEDIA_FEATURES: Record<string, keyof MediaQuery> = { 'min-width': 'minWidth', 'max-width': 'maxWidth', 'min-height': 'minHeight', 'max-height': 'maxHeight' };
const MEDIA_HELP = 'only (min-width | max-width | min-height | max-height: <n>px), joined by "and", are supported';

// @media (min-width: 600px) and (max-height: 400px): the size of the app window, never the screen.
const mediaRule: AtRule = {
  kind: 'media',
  condition: (prelude, preludeAt, at, fail) => {
    if (prelude.trim() === '') {
      fail(at, '@media needs a condition, e.g. @media (min-width: 600px)');
      return undefined;
    }
    const query: MediaQuery = {};
    let valid = true;
    // The conditions are joined by the word "and"; offsets keep every error on the column of its own condition.
    let start = 0;
    for (const joint of [...prelude.matchAll(/\s+and\s+/g), { index: prelude.length, 0: '' }]) {
      const part = prelude.slice(start, joint.index);
      const text = part.trim();
      const partAt = preludeAt + start + part.indexOf(text);
      start = joint.index + joint[0].length;
      const m = /^\(\s*(min-width|max-width|min-height|max-height)\s*:\s*([^)]*?)\s*\)$/.exec(text);
      if (!m) {
        fail(partAt, `unsupported media condition "${text}": ${MEDIA_HELP}`);
        valid = false;
        continue;
      }
      const value = parsePx(m[2]);
      if (value === undefined) {
        fail(partAt, `invalid value "${m[2]}" for "${m[1]}": expected px`);
        valid = false;
      } else if (MEDIA_FEATURES[m[1]] in query) {
        fail(partAt, `"${m[1]}" is given twice in one @media`);
        valid = false;
      } else {
        query[MEDIA_FEATURES[m[1]]] = value;
      }
    }
    return valid ? { kind: 'media', query } : undefined;
  },
};

const AT_RULES: Record<string, AtRule> = { only: targetRule('only'), except: targetRule('except'), media: mediaRule };

// What @media may not change in v1: these decide which widgets are built, so they cannot follow the window size.
const STRUCTURAL = new Set(['justify-content', 'align-items']);

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

  const parseRule = (pos: number, open: number, close: number, conditions: Condition[]): Rule => {
    const inMedia = conditions.some((c) => c.kind === 'media');
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
      if (inMedia && STRUCTURAL.has(property)) {
        fail(propertyAt, `"${property}" is not supported inside @media in v1: it changes how the widgets are built, so it cannot follow the window size (set it outside @media)`);
        continue;
      }
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
    return { selectors, declarations, order: rules.length, ...(conditions.length ? { conditions } : {}) };
  };

  const parseRules = (from: number, to: number, conditions: Condition[]): void => {
    let pos = from;
    while (pos < to) {
      const atRule = /^\s*@([\w-]+)/.exec(source.slice(pos, to));
      if (atRule) {
        const name = atRule[1];
        const nameAt = pos + atRule[0].length - name.length - 1;
        const end = endOfAtRule(source, pos);
        const spec = AT_RULES[name];
        if (!spec) {
          fail(nameAt, `unsupported at-rule "@${name}" in v1`);
          pos = end;
          continue;
        }
        const open = source.indexOf('{', nameAt);
        if (open < 0 || open >= end) {
          fail(nameAt, `@${name} needs a { ... } block`);
          pos = end;
          continue;
        }
        const enclosing = conditions.find((c) => c.kind === spec.kind);
        if (enclosing) {
          fail(nameAt, `@${name} cannot be nested inside @${enclosing.kind === 'media' ? 'media' : enclosing.mode}`);
          pos = end;
          continue;
        }
        const close = matchingBrace(source, open);
        if (close < 0) {
          fail(open, 'unclosed block, expected "}"');
          return;
        }
        const preludeAt = nameAt + 1 + name.length;
        const condition = spec.condition(source.slice(preludeAt, open), preludeAt, nameAt, fail);
        // An invalid prelude was reported already; its rules are still parsed so their own mistakes show up.
        parseRules(open + 1, close, condition ? [...conditions, condition] : conditions);
        pos = close + 1;
        continue;
      }
      const open = source.indexOf('{', pos);
      if (open < 0 || open >= to) break;
      const close = source.indexOf('}', open);
      if (close < 0 || close >= to) {
        fail(open, 'unclosed block, expected "}"');
        break;
      }
      rules.push(parseRule(pos, open, close, conditions));
      pos = close + 1;
    }
  };

  parseRules(0, source.length, []);
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

/** Offset of the "}" that closes the "{" at `open`, or -1. */
function matchingBrace(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return i;
  }
  return -1;
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
