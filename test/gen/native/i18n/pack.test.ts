import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildDriver, hasClang } from './helper.ts';
import type { Driver } from './helper.ts';

let d: Driver;

const HEADER_PT = 'forge-lang 1 pt-BR hello 0.2.0\nplural-forms: nplurals=2; plural=(n > 1);\n';
const HEADER_EN = 'forge-lang 1 en hello 0.2.0\nplural-forms: nplurals=2; plural=n != 1;\n';
const GOOD = HEADER_PT + [
  '# translator note',
  '',
  'Hello, world!\tOlá, mundo!',
  '%d file\t%d arquivo\t%d arquivos',
  'Line\\nbreak\\\\ and\\ttab\tQuebra\\ne\\\\barra\\tTAB',
  '@context menu',
  'Open\tAbrir (menu)',
  '@context',
  'Open\tAbrir',
  '',
].join('\n');

const parse = (content: string | Buffer) => d.run('parse', d.file('p.lang', content)).trim();
const lookup = (content: string | Buffer, context: string, text: string, count: number, plural: boolean) =>
  d.run('lookup', d.file('l.lang', content), context, text, String(count), plural ? '1' : '0');

describe('given the C++ .lang parser', { skip: !hasClang && 'clang++ not installed' }, () => {
  before(() => { d = buildDriver(); });
  after(() => d.dispose());

  describe('when parsing a good pack', () => {
    it('then the header and the entry count are read (comments and blank lines ignored)', () => {
      assert.equal(parse(GOOD),
        'ok tag=pt-BR app=hello version=0.2.0 formula=(n > 1) nplurals=2 entries=5');
    });
    it('then a plural-forms line without a trailing semicolon works too', () => {
      assert.match(parse(HEADER_EN + 'a\tb\n'), /formula=n != 1 nplurals=2 entries=1/);
    });
    it('then CRLF line endings are accepted', () => {
      assert.match(parse(GOOD.replaceAll('\n', '\r\n')), /^ok tag=pt-BR/);
    });
    it('then a final line without a newline is read', () => {
      assert.match(parse(HEADER_PT + 'a\tb'), /entries=1$/);
    });
    it('then a pack with only the header is valid and empty', () => {
      assert.match(parse(HEADER_PT), /entries=0$/);
    });
    it('then exactly 1 MB is accepted', () => {
      const body = 'a\tb\n';
      const filler = '#'.repeat(1024 * 1024 - HEADER_PT.length - body.length - 1) + '\n';
      const content = HEADER_PT + filler + body;
      assert.equal(Buffer.byteLength(content), 1024 * 1024);
      assert.match(parse(content), /^ok /);
    });
  });

  describe('when the header is wrong', () => {
    it('then an empty file reports a missing header', () => {
      assert.equal(parse(''), 'error: line 1: missing header "forge-lang 1 <tag> <app> <version>"');
    });
    it('then a wrong magic word or version is rejected on line 1', () => {
      assert.match(parse('forge-lang 2 pt-BR hello 0.2.0\nplural-forms: nplurals=2; plural=n > 1\n'), /^error: line 1: /);
      assert.match(parse('po 1 pt-BR hello 0.2.0\n'), /^error: line 1: /);
    });
    it('then a header with the wrong number of fields is rejected', () => {
      assert.match(parse('forge-lang 1 pt-BR hello\nplural-forms: nplurals=2; plural=n > 1\n'), /^error: line 1: /);
    });
    it('then an undefined tag is rejected', () => {
      assert.match(parse('forge-lang 1 C hello 0.2.0\nplural-forms: nplurals=2; plural=n > 1\n'), /^error: line 1: invalid tag/);
    });
    it('then a missing plural-forms line is rejected on line 2', () => {
      assert.match(parse('forge-lang 1 pt-BR hello 0.2.0\nHello\tOlá\n'), /^error: line 2: expected "plural-forms: /);
    });
    it('then an invalid plural formula is rejected with its line', () => {
      assert.equal(parse('forge-lang 1 pt-BR hello 0.2.0\nplural-forms: nplurals=2; plural=alert(1)\n'),
        'error: line 2: invalid plural formula');
    });
    it('then a bad nplurals is rejected', () => {
      for (const n of ['0', '7', 'x', '']) {
        assert.match(parse(`forge-lang 1 pt-BR hello 0.2.0\nplural-forms: nplurals=${n}; plural=n > 1\n`), /^error: line 2: /, n);
      }
    });
    it('then comments and blank lines may come before the header', () => {
      assert.match(parse('# generated\n\n' + HEADER_PT), /^ok tag=pt-BR/);
    });
  });

  describe('when an entry is malformed', () => {
    it('then a line without TAB reports its line number', () => {
      assert.equal(parse(HEADER_PT + 'ok\tfine\nno tab here\n'), 'error: line 4: missing TAB');
    });
    it('then an empty English key is rejected', () => {
      assert.equal(parse(HEADER_PT + '\tx\n'), 'error: line 3: empty key');
    });
    it('then an unknown escape is rejected', () => {
      assert.equal(parse(HEADER_PT + 'a\tb\\qc\n'), 'error: line 3: invalid escape \\q');
    });
    it('then a trailing lone backslash is rejected', () => {
      assert.equal(parse(HEADER_PT + 'a\tb\\\n'), 'error: line 3: invalid escape at end of line');
    });
    it('then a wrong number of plural columns is rejected', () => {
      assert.equal(parse(HEADER_PT + '%d file\ta\tb\tc\n'), 'error: line 3: expected 1 or 2 translations, found 3');
    });
    it('then an embedded NUL byte is rejected with its line', () => {
      assert.equal(parse(Buffer.concat([Buffer.from(HEADER_PT + 'a\tb'), Buffer.from([0]), Buffer.from('c\n')])),
        'error: line 3: NUL byte');
    });
    it('then invalid UTF-8 is rejected (lone continuation, overlong, surrogate, beyond U+10FFFF, truncated)', () => {
      const bad = [[0x80], [0xc0, 0x80], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80], [0xe2, 0x82], [0xff]];
      for (const bytes of bad) {
        const content = Buffer.concat([Buffer.from(HEADER_PT + 'a\tb'), Buffer.from(bytes), Buffer.from('\n')]);
        assert.equal(parse(content), 'error: line 3: invalid UTF-8', JSON.stringify(bytes));
      }
    });
    it('then valid multi-byte UTF-8 (2, 3 and 4 bytes) is accepted', () => {
      assert.match(parse(HEADER_PT + 'a\té € \u{1F600}\n'), /entries=1$/);
    });
    it('then invalid UTF-8 inside a comment is rejected too', () => {
      assert.equal(parse(Buffer.concat([Buffer.from(HEADER_PT + '# '), Buffer.from([0xff]), Buffer.from('\n')])),
        'error: line 3: invalid UTF-8');
    });
    it('then a pack over 1 MB is rejected before parsing', () => {
      const content = HEADER_PT + '#'.repeat(1024 * 1024) + '\n';
      assert.equal(parse(content), 'error: pack larger than 1 MB');
    });
  });

  describe('when looking up messages', () => {
    it('then a simple text returns its translation', () => {
      assert.equal(lookup(GOOD, '', 'Hello, world!', 1, false), '[Olá, mundo!]\n');
    });
    it('then escapes are decoded in keys and translations', () => {
      assert.equal(lookup(GOOD, '', 'Line\nbreak\\ and\ttab', 1, false), '[Quebra\ne\\barra\tTAB]\n');
    });
    it('then pt-BR plurals use n > 1: 0 and 1 are singular, 2 is plural', () => {
      assert.equal(lookup(GOOD, '', '%d file', 0, true), '[%d arquivo]\n');
      assert.equal(lookup(GOOD, '', '%d file', 1, true), '[%d arquivo]\n');
      assert.equal(lookup(GOOD, '', '%d file', 2, true), '[%d arquivos]\n');
    });
    it('then en plurals use n != 1: 0 is plural, 1 is singular', () => {
      const en = HEADER_EN + '%d file\t%d file!\t%d files!\n';
      assert.equal(lookup(en, '', '%d file', 0, true), '[%d files!]\n');
      assert.equal(lookup(en, '', '%d file', 1, true), '[%d file!]\n');
      assert.equal(lookup(en, '', '%d file', 5, true), '[%d files!]\n');
    });
    it('then a one-form language (ja) always returns the single form', () => {
      const ja = 'forge-lang 1 ja hello 1.0.0\nplural-forms: nplurals=1; plural=0;\n%d file\t%d ファイル\n';
      assert.equal(lookup(ja, '', '%d file', 7, true), '[%d ファイル]\n');
    });
    it('then a three-form language (ru) picks the form from the formula', () => {
      const ru = 'forge-lang 1 ru hello 1.0.0\nplural-forms: nplurals=3; plural=n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2;\n%d file\ta\tb\tc\n';
      assert.deepEqual([1, 2, 5, 21].map((n) => lookup(ru, '', '%d file', n, true)), ['[a]\n', '[b]\n', '[c]\n', '[a]\n']);
    });
    it('then the context selects the entry, and @context without a name returns to no context', () => {
      assert.equal(lookup(GOOD, 'menu', 'Open', 1, false), '[Abrir (menu)]\n');
      assert.equal(lookup(GOOD, '', 'Open', 1, false), '[Abrir]\n');
    });
    it('then a missing text returns the original', () => {
      assert.equal(lookup(GOOD, '', 'Not translated', 1, false), '[Not translated]\n');
    });
    it('then a text that exists only under another context returns the original', () => {
      assert.equal(lookup(GOOD, 'other', 'Open', 1, false), '[Open]\n');
    });
    it('then an empty translation (an untranslated template line) returns the original', () => {
      assert.equal(lookup(HEADER_PT + 'Hello\t\n', '', 'Hello', 1, false), '[Hello]\n');
    });
    it('then a plural lookup of a one-column entry returns that column', () => {
      assert.equal(lookup(GOOD, '', 'Hello, world!', 3, true), '[Olá, mundo!]\n');
    });
    it('then keys written out of order are still found (entries are sorted after parsing)', () => {
      const pack = HEADER_PT + 'zebra\tz\napple\ta\nmango\tm\n';
      assert.equal(lookup(pack, '', 'apple', 1, false), '[a]\n');
      assert.equal(lookup(pack, '', 'zebra', 1, false), '[z]\n');
      assert.equal(lookup(pack, '', 'mango', 1, false), '[m]\n');
    });
    it('then a duplicated key keeps the first translation (characterization)', () => {
      assert.equal(lookup(HEADER_PT + 'a\tfirst\na\tsecond\n', '', 'a', 1, false), '[first]\n');
    });
  });
});
