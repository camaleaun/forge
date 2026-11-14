// Low-level scanning helpers shared by the parser and the transformer.
import { parseElement } from './parse.ts';

export function locOf(source: string, at: number): [line: number, column: number] {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < at; i++) {
    if (source[i] === '\n') {
      line++;
      lineStart = i + 1;
    }
  }
  return [line, at - lineStart + 1];
}

// Builds an Error whose message is `file:L:C: message`.
export function errorAt(source: string, at: number, file: string, message: string): Error {
  const [line, column] = locOf(source, at);
  return new Error(`${file}:${line}:${column}: ${message}`);
}

const REGEX_KEYWORDS = new Set(['return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'void', 'delete', 'throw', 'new', 'yield', 'await']);

// Decides whether a "/" at `at` starts a regex literal, from the previous significant token.
export function regexAllowed(source: string, at: number): boolean {
  let i = at - 1;
  while (i >= 0 && /\s/.test(source[i])) i--;
  if (i < 0) return true;
  const ch = source[i];
  if (/[\w$]/.test(ch)) {
    let start = i;
    while (start > 0 && /[\w$]/.test(source[start - 1])) start--;
    return REGEX_KEYWORDS.has(source.slice(start, i + 1));
  }
  return !')]}<'.includes(ch);
}

// Decides whether the "<" at `at` starts a JSX element: it must follow a significant
// token after which an expression may start, and look like `<name` or `<>`.
export function isJsxStart(source: string, at: number): boolean {
  const next = source[at + 1];
  if (next !== '>' && !/[A-Za-z_$]/.test(next ?? '')) return false;
  let i = at - 1;
  while (i >= 0 && /\s/.test(source[i])) i--;
  if (i >= 0) {
    const before = source.slice(Math.max(0, i - 6), i + 1);
    const ok =
      '(,=:?[{};!'.includes(source[i]) ||
      before.endsWith('=>') ||
      before.endsWith('&&') ||
      before.endsWith('||') ||
      before.endsWith('??') ||
      /(?:^|[^\w$])return$/.test(before);
    if (!ok) return false;
  }
  // `<T,>(x) => x` and `<T extends U>(x) => x` are generic arrows, not JSX.
  return !/^<[A-Za-z_$][\w$]*(?:\s*,|\s+extends\s+[^=\s{])/.test(source.slice(at, at + 200));
}

// source[at] is a quote; returns the index after the closing quote.
export function skipString(source: string, at: number, file: string): number {
  const quote = source[at];
  for (let i = at + 1; i < source.length; i++) {
    const ch = source[i];
    if (ch === '\\') i++;
    else if (ch === quote) return i + 1;
    else if (ch === '\n') break;
  }
  throw errorAt(source, at, file, 'unterminated string');
}

// source[at] is a backtick; returns the index after the closing backtick.
export function skipTemplate(source: string, at: number, file: string): number {
  for (let i = at + 1; i < source.length; i++) {
    const ch = source[i];
    if (ch === '\\') i++;
    else if (ch === '`') return i + 1;
    else if (ch === '$' && source[i + 1] === '{') i = scanBalanced(source, i + 1, file);
  }
  throw errorAt(source, at, file, 'unterminated template literal');
}

// source[at] starts "//" or "/*"; returns the index after the comment.
export function skipComment(source: string, at: number, file: string): number {
  if (source[at + 1] === '/') {
    const nl = source.indexOf('\n', at);
    return nl === -1 ? source.length : nl;
  }
  const end = source.indexOf('*/', at + 2);
  if (end === -1) throw errorAt(source, at, file, 'unterminated comment');
  return end + 2;
}

// source[at] is "/" starting a regex literal; returns the index after its flags.
export function skipRegex(source: string, at: number, file: string): number {
  let inClass = false;
  for (let i = at + 1; i < source.length; i++) {
    const ch = source[i];
    if (ch === '\n') break;
    if (ch === '\\') i++;
    else if (ch === '[') inClass = true;
    else if (ch === ']') inClass = false;
    else if (ch === '/' && !inClass) {
      i++;
      while (i < source.length && /[a-z]/i.test(source[i])) i++;
      return i;
    }
  }
  throw errorAt(source, at, file, 'unterminated regular expression');
}

// source[open] is "{"; returns the index of the matching "}".
export function scanBalanced(source: string, open: number, file = '<input>'): number {
  let depth = 0;
  let i = open;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '"' || ch === "'") i = skipString(source, i, file);
    else if (ch === '`') i = skipTemplate(source, i, file);
    else if (ch === '/' && (source[i + 1] === '/' || source[i + 1] === '*')) i = skipComment(source, i, file);
    else if (ch === '/' && regexAllowed(source, i)) i = skipRegex(source, i, file);
    else if (ch === '<' && isJsxStart(source, i)) i = parseElement(source, i, file).end;
    else {
      if (ch === '{') depth++;
      else if (ch === '}' && --depth === 0) return i;
      i++;
    }
  }
  throw errorAt(source, open, file, 'unbalanced "{"');
}
