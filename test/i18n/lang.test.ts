import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseLang, encodeLang, decodeUtf8, LangError } from '../../src/i18n/lang.ts';
import type { LangFile } from '../../src/i18n/lang.ts';

const T = '\t';
const errorsOf = (text: string, file = 'pt-BR.lang'): string[] => {
  try {
    parseLang(text, file);
  } catch (e) {
    assert.ok(e instanceof LangError);
    return e.errors;
  }
  return [];
};
const strip = (f: LangFile) => f.entries.map(({ context, text, forms }) => ({ context, text, forms }));

describe('given a .lang text', () => {
  it('when it has one entry then the English text maps to its translation', () => {
    const f = parseLang(`Hello, world!${T}Olá, mundo!\n`, 'pt-BR.lang');
    assert.deepEqual(strip(f), [{ context: undefined, text: 'Hello, world!', forms: ['Olá, mundo!'] }]);
    assert.equal(f.entries[0].line, 1);
  });
  it('when it has comments, blank lines and CRLF endings then they are ignored', () => {
    const f = parseLang(`# note\r\n\r\nA${T}B\r\n  \r\nC${T}D`, 'x.lang');
    assert.deepEqual(strip(f).map((e) => e.forms[0]), ['B', 'D']);
  });
  it('when an entry has more columns then they are the plural forms', () => {
    const f = parseLang(`%d file${T}%d arquivo${T}%d arquivos\n`, 'x.lang');
    assert.deepEqual(f.entries[0].forms, ['%d arquivo', '%d arquivos']);
  });
  it('when @context appears then it applies until the next @context, and a bare one resets', () => {
    const f = parseLang(`A${T}a\n@context noun\nB${T}b\n@context verb\nB${T}b2\n@context\nC${T}c\n`, 'x.lang');
    assert.deepEqual(strip(f).map((e) => [e.context, e.text]), [
      [undefined, 'A'], ['noun', 'B'], ['verb', 'B'], [undefined, 'C'],
    ]);
  });
  it('when the same text is in different contexts then it is not a duplicate', () => {
    assert.deepEqual(errorsOf(`@context a\nB${T}1\n@context b\nB${T}2\n`), []);
  });
  it('when text has escapes then they are decoded', () => {
    const f = parseLang(`a\\\\b\\tc\\nd\\re${T}x\\\\y\\ty\\nz\\rw\n`, 'x.lang');
    assert.equal(f.entries[0].text, 'a\\b\tc\nd\re');
    assert.equal(f.entries[0].forms[0], 'x\\y\ty\nz\rw');
  });
  it('when text has UTF-8 and emoji then it is preserved', () => {
    const f = parseLang(`Ação 🎉${T}Action 🎉 日本語\n`, 'x.lang');
    assert.equal(f.entries[0].text, 'Ação 🎉');
    assert.equal(f.entries[0].forms[0], 'Action 🎉 日本語');
  });
  it('when it has the header lines then the pack carries them', () => {
    const f = parseLang(
      `forge-lang 1 pt-BR hello 0.2.0\nplural-forms: nplurals=2; plural=(n > 1);\nA${T}B\n`, 'pt-BR.lang');
    assert.equal(f.tag, 'pt-BR');
    assert.equal(f.app, 'hello');
    assert.equal(f.version, '0.2.0');
    assert.deepEqual(f.pluralForms, { nplurals: 2, formula: 'n > 1' });
  });
  it('when the plural formula only starts and ends with parentheses then they are kept', () => {
    const f = parseLang('plural-forms: nplurals=3; plural=(n==1) ? 0 : (n>=2 && n<=4) ? 1 : 2;\n', 'x.lang');
    assert.equal(f.pluralForms?.formula, '(n==1) ? 0 : (n>=2 && n<=4) ? 1 : 2');
  });
  it('when it has no header then tag, app and version are absent', () => {
    const f = parseLang(`A${T}B\n`, 'x.lang');
    assert.equal(f.tag, undefined);
    assert.equal(f.pluralForms, undefined);
  });
  it('when it starts with a BOM then the BOM is stripped (characterization)', () => {
    const f = parseLang(`﻿A${T}B\n`, 'x.lang');
    assert.equal(f.entries[0].text, 'A');
  });
});

describe('given a malformed .lang text', () => {
  it('when a line has no TAB then the error is file:line: message', () => {
    assert.deepEqual(errorsOf(`A${T}B\nno tab here\n`), ['pt-BR.lang:2: missing TAB between the English text and the translation']);
  });
  it('when there is a bad escape then the error names it', () => {
    assert.deepEqual(errorsOf(`A\\q${T}B\n`), ['pt-BR.lang:1: bad escape "\\q"']);
  });
  it('when a line ends in a lone backslash then the escape is unterminated', () => {
    assert.deepEqual(errorsOf(`A${T}B\\\n`), ['pt-BR.lang:1: unterminated escape at the end of the line']);
  });
  it('when the same text repeats in the same context then it is a duplicate', () => {
    assert.deepEqual(errorsOf(`A${T}B\n\nA${T}C\n`), ['pt-BR.lang:3: duplicate entry "A" (first defined at line 1)']);
  });
  it('when the English text is empty then it is an error', () => {
    assert.deepEqual(errorsOf(`${T}B\n`), ['pt-BR.lang:1: empty English text']);
  });
  it('when the header version is not 1 then it is a mismatch', () => {
    assert.deepEqual(errorsOf('forge-lang 2 pt-BR hello 1\n'), ['pt-BR.lang:1: unsupported forge-lang version "2" (expected 1)']);
  });
  it('when the header has the wrong number of fields then it is an error', () => {
    assert.deepEqual(errorsOf('forge-lang 1 pt-BR\n'), ['pt-BR.lang:1: header must be "forge-lang 1 <tag> <app> <version>"']);
  });
  it('when the header tag is malformed then it is an error', () => {
    assert.deepEqual(errorsOf('forge-lang 1 ../x hello 1\n'), ['pt-BR.lang:1: invalid language tag "../x" in the header']);
  });
  it('when the header repeats or comes after entries then it is an error', () => {
    assert.deepEqual(errorsOf(`A${T}B\nforge-lang 1 pt-BR a 1\n`), ['pt-BR.lang:2: header must come before the entries']);
    assert.deepEqual(errorsOf('forge-lang 1 pt-BR a 1\nforge-lang 1 pt-BR a 1\n'), ['pt-BR.lang:2: duplicate forge-lang header']);
  });
  it('when plural-forms is malformed then it is an error', () => {
    assert.deepEqual(errorsOf('plural-forms: nplurals=x; plural=n;\n'), ['pt-BR.lang:1: plural-forms must be "nplurals=N; plural=EXPR"']);
  });
  it('when the plural-forms formula is hostile then the evaluator error is reported with the line', () => {
    const e = errorsOf('plural-forms: nplurals=2; plural=alert(1);\n');
    assert.equal(e.length, 1);
    assert.match(e[0], /^pt-BR\.lang:1: invalid plural formula: unknown identifier "alert"$/);
  });
  it('when nplurals is out of range then it is an error', () => {
    assert.match(errorsOf('plural-forms: nplurals=0; plural=0;\n')[0], /nplurals must be between 1 and 6/);
  });
  it('when several lines are bad then all are reported in order', () => {
    const e = errorsOf('x\ny\n');
    assert.equal(e.length, 2);
    assert.match(e[1], /^pt-BR\.lang:2:/);
  });
  it('when it has a NUL byte then it is rejected', () => {
    assert.deepEqual(errorsOf(`A${T}B\0C\n`), ['pt-BR.lang:1: NUL byte is not allowed']);
  });
  it('when a line is very long then it is rejected', () => {
    const e = errorsOf(`A${T}${'x'.repeat(70000)}\n`);
    assert.match(e[0], /^pt-BR\.lang:1: line too long/);
  });
  it('when the whole text is over 1 MB then it is rejected before parsing', () => {
    const big = Array.from({ length: 100000 }, (_, i) => `k${i}${T}vvvvv`).join('\n');
    assert.match(errorsOf(big)[0], /^pt-BR\.lang: file is .* bytes, over the 1 MB limit/);
  });
  it('when there are thousands of bad lines then at most 50 errors are collected', () => {
    assert.equal(errorsOf('x\n'.repeat(5000)).length, 50);
  });
  it('when the LangError message is read then it joins the errors', () => {
    assert.throws(() => parseLang('x\n', 'f.lang'), /^Error: f\.lang:1: missing TAB/);
  });
});

describe('given undecoded bytes', () => {
  it('when they are valid UTF-8 then they decode', () => {
    assert.equal(decodeUtf8(new TextEncoder().encode('Olá 🎉'), 'x.lang'), 'Olá 🎉');
  });
  it('when they are invalid UTF-8 then it throws file: message', () => {
    assert.throws(() => decodeUtf8(new Uint8Array([0x41, 0xff, 0xfe]), 'x.lang'), /^Error: x\.lang: invalid UTF-8/);
  });
});

describe('given a LangFile to encode', () => {
  const base: LangFile = {
    tag: 'pt-BR', app: 'hello', version: '0.2.0',
    entries: [
      { text: 'Greet', forms: ['Cumprimentar'] },
      { text: '%d file', forms: ['%d arquivo', '%d arquivos'] },
    ],
  };
  it('when encoding then it writes the header, the plural-forms line and sorted entries', () => {
    assert.equal(
      encodeLang(base),
      `forge-lang 1 pt-BR hello 0.2.0\nplural-forms: nplurals=2; plural=(n > 1);\n%d file${T}%d arquivo${T}%d arquivos\nGreet${T}Cumprimentar\n`);
  });
  it('when the file carries its plural-forms then they win over the table', () => {
    const out = encodeLang({ ...base, pluralForms: { nplurals: 3, formula: 'n==1 ? 0 : 1' } });
    assert.match(out, /^forge-lang 1 pt-BR hello 0\.2\.0\nplural-forms: nplurals=3; plural=\(n==1 \? 0 : 1\);\n/);
  });
  it('when entries have contexts then they are grouped after the no-context ones, sorted by bytes', () => {
    const out = encodeLang({
      ...base,
      entries: [
        { context: 'verb', text: 'Post', forms: ['Postar'] },
        { text: 'Zed', forms: ['Z'] },
        { context: 'noun', text: 'Post', forms: ['Postagem'] },
        { text: 'Zebra', forms: ['Ze'] },
        { text: 'Édito', forms: ['A'] },
      ],
    });
    const body = out.split('\n').slice(2).join('\n');
    assert.equal(body, `Zebra${T}Ze\nZed${T}Z\nÉdito${T}A\n@context noun\nPost${T}Postagem\n@context verb\nPost${T}Postar\n`);
  });
  it('when the order of the input changes then the output is identical (deterministic)', () => {
    const a = encodeLang(base);
    const b = encodeLang({ ...base, entries: [...base.entries].reverse() });
    assert.equal(a, b);
  });
  it('when an entry is untranslated (all forms empty) then it is left out of the pack', () => {
    const out = encodeLang({ ...base, entries: [...base.entries, { text: 'Todo', forms: [''] }] });
    assert.ok(!out.includes('Todo'));
  });
  it('when text has special characters then they are escaped', () => {
    const out = encodeLang({ ...base, entries: [{ text: 'a\tb\\c', forms: ['x\ny\rz'] }] });
    assert.ok(out.endsWith(`a\\tb\\\\c${T}x\\ny\\rz\n`));
  });
  it('when round-tripping then parse(encode(x)) equals x', () => {
    const file: LangFile = {
      ...base,
      entries: [
        { text: 'Tab\there', forms: ['Aba\taqui'] },
        { text: 'Emoji 🎉', forms: ['Emoji 🎉 日本語'] },
        { context: 'c\\x', text: 'Q', forms: ['q1', 'q2'] },
      ],
    };
    const back = parseLang(encodeLang(file), 'pt-BR.lang');
    assert.equal(back.tag, 'pt-BR');
    assert.equal(back.app, 'hello');
    assert.deepEqual(back.pluralForms, { nplurals: 2, formula: 'n > 1' });
    const key = (e: { context?: string; text: string }) => `${e.context ?? ''}\0${e.text}`;
    assert.deepEqual(strip(back).sort((a, b) => key(a).localeCompare(key(b))),
      strip(file).sort((a, b) => key(a).localeCompare(key(b))));
  });
  it('when encoding twice through parse then the bytes do not change (fixed point)', () => {
    const once = encodeLang(base);
    assert.equal(encodeLang(parseLang(once, 'pt-BR.lang')), once);
  });
  it('when the header data is missing then it is an error', () => {
    assert.throws(() => encodeLang({ entries: [] }), /tag, app and version/);
  });
  it('when the header data has spaces or TABs then it is an error', () => {
    assert.throws(() => encodeLang({ ...base, app: 'my app' }), /app/);
  });
  it('when the output is over 1 MB then it throws a clear error', () => {
    const entries = Array.from({ length: 30000 }, (_, i) => ({ text: `phrase number ${i} ${'x'.repeat(40)}`, forms: ['t'.repeat(10)] }));
    assert.throws(() => encodeLang({ ...base, entries }), /pt-BR\.lang: language pack is \d+ bytes, over the 1 MB limit/);
  });
  it('when a text has a NUL byte then it is an error', () => {
    assert.throws(() => encodeLang({ ...base, entries: [{ text: 'a\0b', forms: ['x'] }] }), /NUL/);
  });
});
