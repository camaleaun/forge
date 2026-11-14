import { errorAt, locOf, scanBalanced } from './scan.ts';

export type Loc = [line: number, column: number];

export type Attr =
  | { name: string; value: { kind: 'string'; value: string } | { kind: 'expr'; code: string } | { kind: 'true' }; loc: Loc };

export type Child =
  | { kind: 'text'; value: string }
  | { kind: 'expr'; code: string; loc: Loc }
  | { kind: 'element'; node: ElementNode };

// name is '' for a fragment (<>...</>).
export type ElementNode = { name: string; attrs: Attr[]; children: Child[]; loc: Loc };

export type Parsed = { node: ElementNode; end: number };

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(?:#x([0-9a-fA-F]+)|#(\d+)|([a-zA-Z]+));/g, (whole, hex, dec, named) => {
    if (hex !== undefined) return String.fromCodePoint(parseInt(hex, 16));
    if (dec !== undefined) return String.fromCodePoint(parseInt(dec, 10));
    return NAMED_ENTITIES[named] ?? whole;
  });
}

// React JSX whitespace rules: trim each line (keeping the edges of the first and
// last line), drop blank lines, join the rest with a single space.
export function normalizeJsxText(raw: string): string {
  const lines = raw.split(/\r\n|\n|\r/);
  const kept: string[] = [];
  lines.forEach((line, i) => {
    let text = line.replace(/\t/g, ' ');
    if (i > 0) text = text.replace(/^ +/, '');
    if (i < lines.length - 1) text = text.replace(/ +$/, '');
    if (text !== '') kept.push(text);
  });
  return kept.join(' ');
}

class Cursor {
  source: string;
  pos: number;
  file: string;
  constructor(source: string, pos: number, file: string) {
    this.source = source;
    this.pos = pos;
    this.file = file;
  }
  loc(at = this.pos): Loc {
    return locOf(this.source, at);
  }
  error(at: number, message: string): Error {
    return errorAt(this.source, at, this.file, message);
  }
  skipSpaces(): void {
    while (/\s/.test(this.source[this.pos] ?? '')) this.pos++;
  }
}

const IDENT = /^[A-Za-z_$][\w$]*/;

// Parses an element name at the cursor; '' means none (fragment or garbage).
function parseName(c: Cursor): string {
  const name = IDENT.exec(c.source.slice(c.pos))?.[0] ?? '';
  const start = c.pos;
  c.pos += name.length;
  if (name !== '' && (c.source[c.pos] === '.' || c.source[c.pos] === ':')) {
    throw c.error(start, 'member and namespace element names are not supported');
  }
  return name;
}

function parseAttrs(c: Cursor, node: ElementNode): void {
  for (;;) {
    c.skipSpaces();
    const ch = c.source[c.pos];
    if (ch === '>' || c.source.startsWith('/>', c.pos)) return;
    if (ch === undefined) return;
    if (ch === '{') throw c.error(c.pos, 'spread attributes are not supported');
    const nameStart = c.pos;
    const name = /^[A-Za-z_$][\w$-]*/.exec(c.source.slice(c.pos))?.[0];
    if (name === undefined) throw c.error(c.pos, 'expected an attribute name');
    c.pos += name.length;
    const loc = c.loc(nameStart);
    if (c.source[c.pos] !== '=') {
      node.attrs.push({ name, value: { kind: 'true' }, loc });
      continue;
    }
    c.pos++;
    const q = c.source[c.pos];
    if (q === '"' || q === "'") {
      // JSX attribute strings have no escapes and may span lines.
      const end = c.source.indexOf(q, c.pos + 1);
      if (end === -1) throw c.error(c.pos, 'unterminated string');
      node.attrs.push({ name, value: { kind: 'string', value: decodeEntities(c.source.slice(c.pos + 1, end)) }, loc });
      c.pos = end + 1;
    } else if (q === '{') {
      const end = scanBalanced(c.source, c.pos, c.file);
      const code = c.source.slice(c.pos + 1, end);
      if (ONLY_COMMENTS.test(code)) throw c.error(c.pos, 'expected an expression');
      node.attrs.push({ name, value: { kind: 'expr', code }, loc });
      c.pos = end + 1;
    } else {
      throw c.error(c.pos, 'expected a string or {expression} as attribute value');
    }
  }
}

function parseNode(c: Cursor): ElementNode {
  const loc = c.loc();
  c.pos++; // '<'
  const name = parseName(c);
  if (name === '' && c.source[c.pos] !== '>') throw c.error(c.pos, 'expected an element name');
  const node: ElementNode = { name, attrs: [], children: [], loc };
  parseAttrs(c, node);
  if (c.source.startsWith('/>', c.pos)) {
    c.pos += 2;
    return node;
  }
  if (c.source[c.pos] !== '>') throw c.error(c.pos, `unterminated JSX element <${name}> opened at ${loc[0]}:${loc[1]}`);
  c.pos++;
  parseChildren(c, node);
  const closeAt = c.pos;
  c.pos += 2; // '</'
  const closeName = parseName(c);
  c.skipSpaces();
  if (closeName !== name) {
    throw c.error(closeAt, `expected </${name}> but found </${closeName}>`);
  }
  c.pos++; // '>'
  return node;
}

const ONLY_COMMENTS = /^\s*(?:\/\*[\s\S]*?\*\/\s*)*$/;

function parseChildren(c: Cursor, node: ElementNode): void {
  let textStart = c.pos;
  const flush = (end: number) => {
    const value = decodeEntities(normalizeJsxText(c.source.slice(textStart, end)));
    if (value !== '') node.children.push({ kind: 'text', value });
  };
  while (c.pos < c.source.length) {
    const ch = c.source[c.pos];
    if (c.source.startsWith('</', c.pos)) {
      flush(c.pos);
      return;
    }
    if (ch === '<') {
      flush(c.pos);
      node.children.push({ kind: 'element', node: parseNode(c) });
      textStart = c.pos;
    } else if (ch === '{') {
      flush(c.pos);
      const end = scanBalanced(c.source, c.pos, c.file);
      const code = c.source.slice(c.pos + 1, end);
      if (!ONLY_COMMENTS.test(code)) node.children.push({ kind: 'expr', code, loc: c.loc() });
      c.pos = end + 1;
      textStart = c.pos;
    } else if (ch === '}') {
      throw c.error(c.pos, 'unexpected "}"');
    } else {
      c.pos++;
    }
  }
  throw c.error(c.pos, `unterminated JSX element <${node.name}> opened at ${node.loc[0]}:${node.loc[1]}`);
}

export function parseElement(source: string, offset: number, file = '<input>'): Parsed {
  const c = new Cursor(source, offset, file);
  const node = parseNode(c);
  return { node, end: c.pos };
}
