import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { CLIENT_SOURCE } from '../../src/dev/i18n-client.ts';
import { encodeLang, parseLang } from '../../src/i18n/lang.ts';
import { formatPrintf } from '../../src/i18n/format.ts';
import { compilePlural } from '../../src/i18n/plural.ts';

const vectors = JSON.parse(readFileSync(new URL('../fixtures/i18n/vectors.json', import.meta.url), 'utf8'));

// The browser runs this exact source text; here it runs in a bare vm context, like a page would.
type Client = {
  forgeNormalizeTag(raw: string): string | undefined;
  forgePickLocale(preferred: string[], available: string[]): string;
  forgeCompilePlural(formula: string): (n: number) => number;
  forgeFormat(pattern: string, args: (string | number)[]): string;
  forgeParseLang(text: string): { plural: ((n: number) => number) | null; entries: Record<string, string[]> };
};
const client = vm.runInNewContext(`${CLIENT_SOURCE}\n({forgeNormalizeTag,forgePickLocale,forgeCompilePlural,forgeFormat,forgeParseLang})`) as Client;

describe('given the client copy of the locale functions, run in node:vm', () => {
  it('when normalizing the shared vectors then it matches', () => {
    for (const [raw, expected] of vectors.normalizeTag) {
      assert.equal(client.forgeNormalizeTag(raw) ?? null, expected, raw);
    }
  });
  it('when picking a locale for the shared vectors then it matches', () => {
    for (const v of vectors.pickLocale) {
      assert.equal(client.forgePickLocale(v.preferred, v.available), v.expected, JSON.stringify(v));
    }
  });
});

describe('given the client copy of the plural evaluator, run in node:vm', () => {
  it('when evaluating the shared plural cases then every n gives the expected form', () => {
    for (const v of vectors.plural) {
      const f = client.forgeCompilePlural(v.formula);
      for (const [n, form] of v.cases) assert.equal(f(n), form, `${v.name} n=${n}`);
    }
  });
  it('when compiling the shared invalid formulas then each throws', () => {
    for (const formula of vectors.invalidFormulas) {
      assert.throws(() => client.forgeCompilePlural(formula), undefined, formula);
    }
  });
  it('when evaluating odd inputs then it agrees with the TypeScript core', () => {
    const formulas = ['n != 1', 'n % (n - n)', 'n / (n - n) + 1', '(n+1)*(n-3)', '!n', 'n>1 ? n<5 ? 1 : 2 : 0', '999999999 * 5'];
    for (const formula of formulas) {
      const [mine, core] = [client.forgeCompilePlural(formula), compilePlural(formula)];
      for (const n of [0, 1, 2, 3, 7, 1.9, -4, NaN, Infinity, 2 ** 40]) assert.equal(mine(n), core(n), `${formula} n=${n}`);
    }
  });
  it('when dividing by a literal zero then it throws like the core', () => {
    assert.throws(() => client.forgeCompilePlural('n / 0'));
  });
});

describe('given the client printf', () => {
  it('when formatting then it agrees with formatPrintf', () => {
    const cases: [string, (string | number)[]][] = [
      ['Hello, %s!', ['Ana']], ['%d files', [3]], ['%2$s then %1$s', ['a', 'b']], ['100%% of %s', ['x']],
      ['%s %s', ['only']], ['%d', ['abc']], ['%d', [3.9]], ['%x', [1]],
    ];
    for (const [pattern, args] of cases) assert.equal(client.forgeFormat(pattern, args), formatPrintf(pattern, args), pattern);
  });
});

describe('given the client .lang parser', () => {
  const pack = encodeLang({
    tag: 'pt-BR', app: 'demo', version: '1.0.0',
    entries: [
      { text: 'Press the button', forms: ['Aperte o botão'] },
      { text: '%d file', forms: ['%d arquivo', '%d arquivos'] },
      { context: 'menu', text: 'Open', forms: ['Abrir'] },
      { text: 'Tab\there', forms: ['Aba\\\nlinha'] },
    ],
  });
  it('when parsing a published pack then entries, contexts, escapes and plural match parseLang', () => {
    const got = client.forgeParseLang(pack);
    const core = parseLang(pack, 'pt-BR.lang');
    assert.equal(Object.keys(got.entries).length, core.entries.length);
    for (const e of core.entries) assert.deepEqual([...got.entries[`${e.context ?? ''}\u0004${e.text}`]], e.forms);
    assert.equal(got.plural!(1), 0);
    assert.equal(got.plural!(3), 1);
  });
  it('when the plural-forms line is bad then plural is null and entries still load', () => {
    const got = client.forgeParseLang('plural-forms: nplurals=2; plural=alert(1);\nA\tB\n');
    assert.equal(got.plural, null);
    assert.deepEqual([...got.entries['\u0004A']], ['B']);
  });
  it('when lines are malformed then they are skipped, never thrown', () => {
    const got = client.forgeParseLang('# c\n\nno tab here\nA\tB\\q\nC\tD\n');
    assert.deepEqual([...Object.keys(got.entries)], ['\u0004C']);
  });
  it('when an English text is __proto__ then it is just an entry', () => {
    const got = client.forgeParseLang('__proto__\tx\n');
    assert.deepEqual([...got.entries['\u0004__proto__']], ['x']);
  });
});
