// The `.lang` text format: one parser/encoder for both the translator's source
// files (i18n/<tag>.lang) and the language pack published with a release.
//
//   # comment                          ignored, as are blank lines
//   forge-lang 1 <tag> <app> <version> optional header (the pack carries it)
//   plural-forms: nplurals=N; plural=EXPR   optional (the pack carries it)
//   @context noun                      applies until the next @context (bare = none)
//   English text<TAB>translation       plural: more TAB columns, one per form
//
// Escapes in every field: \\ \t \n \r. Input is UTF-8 text that is already
// decoded (see decodeUtf8). A leading BOM is stripped. Errors read
// "file:line: message"; parseLang collects up to 50 and throws a LangError.
import { normalizeTag } from './locale.ts';
import { compilePlural, pluralFormsFor } from './plural.ts';

export type LangEntry = {
  context?: string;
  text: string;
  /** One translation per plural form (a single one for a singular message). */
  forms: string[];
  /** 1-based source line, set by parseLang. */
  line?: number;
};
export type LangFile = {
  tag?: string;
  app?: string;
  version?: string;
  pluralForms?: { nplurals: number; formula: string };
  entries: LangEntry[];
};

export const MAX_LANG_BYTES = 1024 * 1024;
const MAX_LINE_CHARS = 65536;
const MAX_ERRORS = 50;

export class LangError extends Error {
  errors: string[] = [];
}

function langError(errors: string[]): LangError {
  const e = new LangError(errors.join('\n'));
  e.errors = errors;
  return e;
}

/** Decodes strict UTF-8; invalid bytes throw "file: invalid UTF-8". */
export function decodeUtf8(bytes: Uint8Array, file: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Error(`${file}: invalid UTF-8`);
  }
}

function unescape(s: string): string {
  if (!s.includes('\\')) return s;
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '\\') {
      out += s[i];
      continue;
    }
    const c = s[i + 1];
    if (c === undefined) throw new Error('unterminated escape at the end of the line');
    if (c === '\\') out += '\\';
    else if (c === 't') out += '\t';
    else if (c === 'n') out += '\n';
    else if (c === 'r') out += '\r';
    else throw new Error(`bad escape "\\${c}"`);
    i++;
  }
  return out;
}

function escape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

/** Removes one pair of parentheses that wraps the whole expression. */
function unwrap(expr: string): string {
  if (!expr.startsWith('(') || !expr.endsWith(')')) return expr;
  let depth = 0;
  for (let i = 0; i < expr.length; i++) {
    if (expr[i] === '(') depth++;
    else if (expr[i] === ')' && --depth === 0 && i < expr.length - 1) return expr;
  }
  return expr.slice(1, -1).trim();
}

function parsePluralForms(line: string): { nplurals: number; formula: string } {
  const m = /^plural-forms:\s*nplurals=(\d+)\s*;\s*plural=(.+?)\s*;?\s*$/.exec(line);
  if (!m) throw new Error('plural-forms must be "nplurals=N; plural=EXPR"');
  const nplurals = Number(m[1]);
  if (nplurals < 1 || nplurals > 6) throw new Error('nplurals must be between 1 and 6');
  const formula = unwrap(m[2]);
  compilePlural(formula);
  return { nplurals, formula };
}

export function parseLang(text: string, file: string): LangFile {
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > MAX_LANG_BYTES) throw langError([`${file}: file is ${bytes} bytes, over the 1 MB limit`]);
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const result: LangFile = { entries: [] };
  const errors: string[] = [];
  const seen = new Map<string, number>();
  let context: string | undefined;
  let sawHeader = false;
  let sawPlural = false;
  const lines = text.split('\n');

  for (let i = 0; i < lines.length && errors.length < MAX_ERRORS; i++) {
    const no = i + 1;
    let line = lines[i];
    if (line.endsWith('\r')) line = line.slice(0, -1);
    try {
      if (line.length > MAX_LINE_CHARS) throw new Error(`line too long (over ${MAX_LINE_CHARS} characters)`);
      if (line.includes('\0')) throw new Error('NUL byte is not allowed');
      if (line.trim() === '' || line.startsWith('#')) continue;

      if (line === 'forge-lang' || line.startsWith('forge-lang ')) {
        if (sawHeader) throw new Error('duplicate forge-lang header');
        if (result.entries.length > 0) throw new Error('header must come before the entries');
        sawHeader = true;
        const parts = line.split(/\s+/);
        if (parts.length !== 5) throw new Error('header must be "forge-lang 1 <tag> <app> <version>"');
        if (parts[1] !== '1') throw new Error(`unsupported forge-lang version "${parts[1]}" (expected 1)`);
        if (normalizeTag(parts[2]) === undefined) throw new Error(`invalid language tag "${parts[2]}" in the header`);
        result.tag = normalizeTag(parts[2]);
        result.app = parts[3];
        result.version = parts[4];
        continue;
      }
      if (line.startsWith('plural-forms:')) {
        if (sawPlural) throw new Error('duplicate plural-forms header');
        if (result.entries.length > 0) throw new Error('header must come before the entries');
        sawPlural = true;
        result.pluralForms = parsePluralForms(line);
        continue;
      }
      if (!line.includes('\t') && (line === '@context' || line.startsWith('@context '))) {
        const name = unescape(line.slice('@context'.length).trim());
        context = name === '' ? undefined : name;
        continue;
      }

      const cols = line.split('\t');
      if (cols.length < 2) throw new Error('missing TAB between the English text and the translation');
      const english = unescape(cols[0]);
      if (english === '') throw new Error('empty English text');
      const forms = cols.slice(1).map(unescape);
      const key = `${context ?? ''}\0${english}`;
      const first = seen.get(key);
      if (first !== undefined) throw new Error(`duplicate entry "${english}" (first defined at line ${first})`);
      seen.set(key, no);
      const entry: LangEntry = { text: english, forms, line: no };
      if (context !== undefined) entry.context = context;
      result.entries.push(entry);
    } catch (e) {
      errors.push(`${file}:${no}: ${(e as Error).message}`);
    }
  }
  if (errors.length > 0) throw langError(errors);
  return result;
}

function byBytes(a: string, b: string): number {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

/**
 * Produces the published pack: header, plural-forms line, then the translated
 * entries sorted by bytes (no-context first, then by context, then by text).
 * Untranslated entries (every form empty) are left out. Throws over 1 MB.
 */
export function encodeLang(file: LangFile): string {
  const { tag, app, version } = file;
  if (!tag || !app || !version) throw new Error('encodeLang needs the tag, app and version of the pack');
  if (normalizeTag(tag) !== tag) throw new Error(`invalid language tag "${tag}"`);
  for (const [name, value] of [['app', app], ['version', version]]) {
    if (/\s/.test(value)) throw new Error(`invalid ${name} "${value}" (no whitespace allowed)`);
  }
  const forms = file.pluralForms ?? pluralFormsFor(tag);
  const entries = file.entries
    .filter((e) => e.forms.some((f) => f !== ''))
    .sort((a, b) => byBytes(a.context ?? '', b.context ?? '') || byBytes(a.text, b.text));

  const out = [`forge-lang 1 ${tag} ${app} ${version}`, `plural-forms: nplurals=${forms.nplurals}; plural=(${forms.formula});`];
  let context = '';
  for (const e of entries) {
    const c = e.context ?? '';
    if (c !== context) {
      if (c !== c.trim()) throw new Error(`invalid context "${c}" (leading or trailing whitespace)`);
      out.push(c === '' ? '@context' : `@context ${escape(c)}`);
      context = c;
    }
    if ([e.text, c, ...e.forms].some((s) => s.includes('\0'))) throw new Error(`NUL byte in entry "${e.text}"`);
    out.push([e.text, ...e.forms].map(escape).join('\t'));
  }
  const text = out.join('\n') + '\n';
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > MAX_LANG_BYTES) throw new Error(`${tag}.lang: language pack is ${bytes} bytes, over the 1 MB limit`);
  return text;
}
