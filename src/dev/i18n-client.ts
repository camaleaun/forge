// Browser-side copies of the i18n core for the preview page, written as plain
// ES5-style functions. Node strips the types, so Function.prototype.toString()
// gives the exact JavaScript the page runs: the TypeScript tests exercise the
// very text that is embedded (see CLIENT_SOURCE), against the shared vectors in
// test/fixtures/i18n/vectors.json. Each function may only call the others by
// name and use no module-level values.
//
// Mirrors: normalizeTag/pickLocale (src/i18n/locale.ts), compilePlural
// (src/i18n/plural.ts), formatPrintf (src/i18n/format.ts) and the published-pack
// part of parseLang (src/i18n/lang.ts). Unlike parseLang, the client parser is
// lenient: a bad line is skipped and a bad plural formula leaves `plural` null,
// so a damaged pack degrades to English instead of breaking the page.

export function forgeNormalizeTag(raw: string): string | undefined {
  if (raw.length > 200) return undefined;
  var base = raw.trim().split(/[.@]/)[0].replace(/_/g, '-');
  if (base === '' || base === 'C' || base === 'POSIX' || base.length > 35) return undefined;
  var parts = base.split('-');
  if (!/^[A-Za-z]{2,3}$/.test(parts[0])) return undefined;
  var out = [parts[0].toLowerCase()];
  for (var i = 1; i < parts.length; i++) {
    var part = parts[i];
    if (!/^[A-Za-z0-9]{1,8}$/.test(part)) return undefined;
    if (/^[A-Za-z]{4}$/.test(part)) out.push(part.charAt(0).toUpperCase() + part.slice(1).toLowerCase());
    else if (/^([A-Za-z]{2}|[0-9]{3})$/.test(part)) out.push(part.toUpperCase());
    else out.push(part.toLowerCase());
  }
  return out.join('-');
}

export function forgePickLocale(preferred: string[], available: string[]): string {
  var packs: string[] = [];
  var i: number;
  var j: number;
  for (i = 0; i < available.length; i++) {
    var normalized = forgeNormalizeTag(available[i]);
    if (normalized !== undefined) packs.push(normalized);
  }
  for (i = 0; i < preferred.length; i++) {
    var tag = forgeNormalizeTag(preferred[i]);
    if (tag === undefined) continue;
    var lang = tag.split('-')[0];
    if (lang === 'en') return 'en';
    for (j = 0; j < packs.length; j++) if (packs[j] === tag) return tag;
    for (j = 0; j < packs.length; j++) if (packs[j] === lang) return lang;
    for (j = 0; j < packs.length; j++) if (packs[j].split('-')[0] === lang) return packs[j];
  }
  return 'en';
}

export function forgeCompilePlural(formula: string): (n: number) => number {
  var MAX_DEPTH = 32;
  var toks: { t: string; v?: any }[] = [];
  var pos = 0;
  var depth = 0;
  function fail(msg: string): never {
    throw new Error('invalid plural formula: ' + msg);
  }
  if (formula.length > 512) fail('too long');
  var i = 0;
  while (i < formula.length) {
    var c = formula.charAt(i);
    if (c === ' ' || c === '\t') {
      i++;
      continue;
    }
    if (toks.length >= 256) fail('too long');
    if (c >= '0' && c <= '9') {
      var j = i;
      while (j < formula.length && formula.charAt(j) >= '0' && formula.charAt(j) <= '9') j++;
      if (j - i > 9) fail('number literal too large');
      toks.push({ t: 'num', v: Number(formula.slice(i, j)) });
      i = j;
    } else if (c === 'n') {
      if (/[A-Za-z0-9_]/.test(formula.charAt(i + 1))) fail('unknown identifier');
      toks.push({ t: 'n' });
      i++;
    } else if (/[A-Za-z_]/.test(c)) {
      fail('unknown identifier');
    } else {
      var two = formula.slice(i, i + 2);
      if (two === '<=' || two === '>=' || two === '==' || two === '!=' || two === '&&' || two === '||') {
        toks.push({ t: 'op', v: two });
        i += 2;
      } else if ('*/%+-<>!?:()'.indexOf(c) >= 0) {
        toks.push({ t: 'op', v: c });
        i++;
      } else {
        fail('unexpected character');
      }
    }
  }
  var LEVELS = [['||'], ['&&'], ['==', '!='], ['<', '>', '<=', '>='], ['+', '-'], ['*', '/', '%']];
  function apply(op: string, a: number, b: number): number {
    switch (op) {
      case '||': return a !== 0 || b !== 0 ? 1 : 0;
      case '&&': return a !== 0 && b !== 0 ? 1 : 0;
      case '==': return a === b ? 1 : 0;
      case '!=': return a !== b ? 1 : 0;
      case '<': return a < b ? 1 : 0;
      case '>': return a > b ? 1 : 0;
      case '<=': return a <= b ? 1 : 0;
      case '>=': return a >= b ? 1 : 0;
      case '+': return (a + b) | 0;
      case '-': return (a - b) | 0;
      case '*': return Math.imul(a, b);
      case '/': return b === 0 ? 0 : Math.trunc(a / b) | 0;
      default: return b === 0 ? 0 : (a % b) | 0;
    }
  }
  function peekOp(): string | undefined {
    var t = toks[pos];
    return t && t.t === 'op' ? t.v : undefined;
  }
  function enter(): void {
    if (++depth > MAX_DEPTH) fail('too deeply nested');
  }
  function ternary(): (n: number) => number {
    var cond = binary(0);
    if (peekOp() !== '?') return cond;
    pos++;
    enter();
    var a = ternary();
    if (peekOp() !== ':') fail('expected ":"');
    pos++;
    var b = ternary();
    depth--;
    return function (n) {
      return cond(n) !== 0 ? a(n) : b(n);
    };
  }
  function binary(level: number): (n: number) => number {
    if (level === LEVELS.length) return unary();
    var left = binary(level + 1);
    for (;;) {
      var op = peekOp();
      if (op === undefined || LEVELS[level].indexOf(op) < 0) return left;
      pos++;
      var divisor = toks[pos];
      if ((op === '/' || op === '%') && divisor && divisor.t === 'num' && divisor.v === 0) fail('division by zero');
      var right = binary(level + 1);
      left = (function (l, r, o) {
        return function (n: number) {
          return apply(o, l(n), r(n));
        };
      })(left, right, op);
    }
  }
  function unary(): (n: number) => number {
    if (peekOp() === '!') {
      pos++;
      enter();
      var inner = unary();
      depth--;
      return function (n) {
        return inner(n) === 0 ? 1 : 0;
      };
    }
    return primary();
  }
  function primary(): (n: number) => number {
    var t = toks[pos];
    if (!t) return fail('unexpected end of formula');
    if (t.t === 'num') {
      pos++;
      var v = t.v;
      return function () {
        return v;
      };
    }
    if (t.t === 'n') {
      pos++;
      return function (n) {
        return n;
      };
    }
    if (t.v === '(') {
      pos++;
      enter();
      var inner = ternary();
      depth--;
      if (peekOp() !== ')') fail('expected ")"');
      pos++;
      return inner;
    }
    return fail('unexpected token');
  }
  if (toks.length === 0) fail('empty formula');
  var f = ternary();
  if (pos < toks.length) fail('unexpected token');
  return function (n) {
    var m = isFinite(n) ? Math.min(Math.trunc(Math.abs(n)), 0x7fffffff) : 0;
    return Math.max(0, f(m));
  };
}

export function forgeFormat(pattern: string, args: (string | number)[]): string {
  var next = 0;
  return pattern.replace(/%(?:(\d{1,2})\$)?([sd%])/g, function (whole: string, position: string | undefined, conversion: string) {
    if (conversion === '%') return '%';
    var index = position === undefined ? next++ : Number(position) - 1;
    if (index < 0 || index >= args.length) return whole;
    var value = args[index];
    if (conversion === 's') return String(value);
    var number = Math.trunc(Number(value));
    return isFinite(number) ? String(number) : whole;
  });
}

export function forgeParseLang(text: string): { plural: ((n: number) => number) | null; entries: Record<string, string[]> } {
  var entries: Record<string, string[]> = Object.create(null);
  var plural: ((n: number) => number) | null = null;
  var context = '';
  var lines = text.replace(/^﻿/, '').split('\n');
  function unescape(s: string): string {
    var out = '';
    for (var i = 0; i < s.length; i++) {
      if (s.charAt(i) !== '\\') {
        out += s.charAt(i);
        continue;
      }
      var c = s.charAt(i + 1);
      if (c === '\\') out += '\\';
      else if (c === 't') out += '\t';
      else if (c === 'n') out += '\n';
      else if (c === 'r') out += '\r';
      else throw new Error('bad escape');
      i++;
    }
    return out;
  }
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (line.charAt(line.length - 1) === '\r') line = line.slice(0, -1);
    if (line.replace(/\s+/g, '') === '' || line.charAt(0) === '#') continue;
    try {
      if (line === 'forge-lang' || line.indexOf('forge-lang ') === 0) continue;
      if (line.indexOf('plural-forms:') === 0) {
        var m = /^plural-forms:\s*nplurals=(\d+)\s*;\s*plural=(.+?)\s*;?\s*$/.exec(line);
        try {
          plural = m ? forgeCompilePlural(m[2]) : null;
        } catch (e) {
          plural = null;
        }
        continue;
      }
      if (line.indexOf('\t') < 0 && (line === '@context' || line.indexOf('@context ') === 0)) {
        context = unescape(line.slice(8).trim());
        continue;
      }
      var cols = line.split('\t');
      if (cols.length < 2) continue;
      var english = unescape(cols[0]);
      if (english === '') continue;
      var forms: string[] = [];
      for (var k = 1; k < cols.length; k++) forms.push(unescape(cols[k]));
      entries[context + '\u0004' + english] = forms;
    } catch (e) {
      continue;
    }
  }
  return { plural: plural, entries: entries };
}

/** The functions above as JavaScript text, ready to embed in a page. */
export const CLIENT_SOURCE: string = [forgeNormalizeTag, forgePickLocale, forgeCompilePlural, forgeFormat, forgeParseLang]
  .map((fn) => fn.toString())
  .join('\n');
