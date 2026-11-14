import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog } from '../../src/i18n/catalog.ts';

const T = '\t';
const f = (name: string, text: string) => ({ name, text });
const phrases = [
  { text: 'Greet' },
  { text: 'Hello, world!' },
  { text: '%d file', plural: '%d files' },
  { text: 'Post', context: 'noun' },
];
const full = `Greet${T}Cumprimentar\nHello, world!${T}Olá, mundo!\n%d file${T}%d arquivo${T}%d arquivos\n@context noun\nPost${T}Postagem\n`;

describe('given i18n files', () => {
  it('when the name is pt_BR.lang or pt-br.lang then the locale is pt-BR', () => {
    for (const name of ['i18n/pt_BR.lang', 'i18n/pt-br.lang', 'pt-BR.lang']) {
      const c = loadCatalog([f(name, `A${T}B\n`)]);
      assert.deepEqual(c.errors, [], name);
      assert.deepEqual(c.locales.map((l) => l.tag), ['pt-BR'], name);
    }
  });
  it('when two files normalize to the same locale then it is an error', () => {
    const c = loadCatalog([f('i18n/pt_BR.lang', `A${T}B\n`), f('i18n/pt-br.lang', `A${T}B\n`)]);
    assert.deepEqual(c.errors, ['i18n/pt-br.lang: duplicate of i18n/pt_BR.lang (both are pt-BR)']);
  });
  it('when the file is en.lang then English is built in and the file is an error', () => {
    const c = loadCatalog([f('en.lang', `A${T}B\n`)]);
    assert.deepEqual(c.errors, ['en.lang: English is the built-in default language; remove this file']);
    assert.deepEqual(c.locales, []);
  });
  it('when the file is en_US.lang then it is also an English error', () => {
    assert.deepEqual(loadCatalog([f('i18n/en_US.lang', '')]).errors, ['i18n/en_US.lang: English is the built-in default language; remove this file']);
  });
  it('when the name is not a locale then it is an error', () => {
    const c = loadCatalog([f('i18n/portuguese.lang', ''), f('i18n/pt-BR.txt', ''), f('i18n/../x.lang', '')]);
    assert.equal(c.errors.length, 3);
    assert.match(c.errors[0], /^i18n\/portuguese\.lang: file name must be <language tag>\.lang/);
  });
  it('when the file is template.lang then it is ignored', () => {
    const c = loadCatalog([f('i18n/template.lang', `A${T}\n`)]);
    assert.deepEqual(c, { locales: [], errors: [], warnings: [] });
  });
  it('when the file has a syntax error then it is reported with file:line and the locale is dropped', () => {
    const c = loadCatalog([f('i18n/pt-BR.lang', 'oops\n')]);
    assert.deepEqual(c.errors, ['i18n/pt-BR.lang:1: missing TAB between the English text and the translation']);
    assert.deepEqual(c.locales, []);
  });
  it('when the header tag disagrees with the file name then it is an error', () => {
    const c = loadCatalog([f('i18n/pt-BR.lang', `forge-lang 1 fr app 1\nA${T}B\n`)]);
    assert.deepEqual(c.errors, ['i18n/pt-BR.lang: the header says "fr" but the file name says "pt-BR"']);
  });
  it('when locales are given in any order then they come back sorted by tag', () => {
    const c = loadCatalog([f('ru.lang', ''), f('fr.lang', ''), f('pt-BR.lang', '')]);
    assert.deepEqual(c.locales.map((l) => l.tag), ['fr', 'pt-BR', 'ru']);
  });
});

describe('given plural columns', () => {
  it('when a plural entry has the wrong number of columns then it is an error with the line', () => {
    const c = loadCatalog([f('i18n/pt-BR.lang', `Greet${T}x\n%d file${T}%d arquivo\n`)], { appPhrases: [{ text: 'Greet' }, { text: '%d file', plural: '%d files' }] });
    assert.deepEqual(c.errors, ['i18n/pt-BR.lang:2: "%d file" needs 2 plural forms for pt-BR but has 1']);
  });
  it('when a singular phrase has several columns then it is an error', () => {
    const c = loadCatalog([f('i18n/pt-BR.lang', `Greet${T}a${T}b\n`)], { appPhrases: [{ text: 'Greet' }] });
    assert.deepEqual(c.errors, ['i18n/pt-BR.lang:1: "Greet" is not plural but has 2 columns']);
  });
  it('when the language has one form (ja) then a plural phrase needs exactly one column', () => {
    const ok = loadCatalog([f('ja.lang', `%d file${T}%dファイル\n`)], { appPhrases: [{ text: '%d file', plural: '%d files' }] });
    assert.deepEqual(ok.errors, []);
    const bad = loadCatalog([f('ja.lang', `%d file${T}a${T}b\n`)], { appPhrases: [{ text: '%d file', plural: '%d files' }] });
    assert.equal(bad.errors.length, 1);
  });
  it('when no phrases are given then columns must be 1 or the plural count', () => {
    assert.deepEqual(loadCatalog([f('pt-BR.lang', `A${T}a${T}b\n`)]).errors, []);
    assert.deepEqual(loadCatalog([f('pt-BR.lang', `A${T}a${T}b${T}c\n`)]).errors,
      ['pt-BR.lang:1: "A" has 3 columns but pt-BR has 2 plural forms']);
  });
  it('when the file carries plural-forms with another nplurals than the table then it is an error', () => {
    const c = loadCatalog([f('pt-BR.lang', `plural-forms: nplurals=3; plural=n;\nA${T}a\n`)]);
    assert.deepEqual(c.errors, ['pt-BR.lang: plural-forms says nplurals=3 but pt-BR has 2']);
  });
});

describe('given the app phrases', () => {
  it('when everything is translated then there are no warnings', () => {
    const c = loadCatalog([f('i18n/pt-BR.lang', full)], { appPhrases: phrases });
    assert.deepEqual(c.errors, []);
    assert.deepEqual(c.warnings, []);
  });
  it('when a phrase is missing then it warns, naming the context when there is one', () => {
    const c = loadCatalog([f('i18n/pt-BR.lang', `Hello, world!${T}Olá!\n`)], { appPhrases: phrases });
    assert.deepEqual(c.errors, []);
    assert.deepEqual(c.warnings, [
      'i18n/pt-BR.lang: missing "Greet"',
      'i18n/pt-BR.lang: missing "%d file"',
      'i18n/pt-BR.lang: missing "Post" (context "noun")',
    ]);
  });
  it('when a phrase has an empty translation then it counts as missing', () => {
    const c = loadCatalog([f('i18n/pt-BR.lang', `Greet${T}\n`)], { appPhrases: [{ text: 'Greet' }] });
    assert.deepEqual(c.warnings, ['i18n/pt-BR.lang: missing "Greet"']);
  });
  it('when an entry is not used by the app then it warns about the orphan with its line', () => {
    const c = loadCatalog([f('i18n/pt-BR.lang', `Greet${T}a\nOld${T}b\n`)], { appPhrases: [{ text: 'Greet' }] });
    assert.deepEqual(c.warnings, ['i18n/pt-BR.lang:2: orphan "Old" (the app no longer uses it)']);
  });
  it('when the same text exists only in another context then it is missing and orphan', () => {
    const c = loadCatalog([f('i18n/pt-BR.lang', `@context verb\nPost${T}Postar\n`)], { appPhrases: [{ text: 'Post', context: 'noun' }] });
    assert.equal(c.warnings.length, 2);
  });
  it('when no phrases are given then there are no coverage warnings', () => {
    assert.deepEqual(loadCatalog([f('pt-BR.lang', `A${T}B\n`)]).warnings, []);
  });
});

describe('given placeholders', () => {
  const check = (en: string, tr: string, plural?: string) =>
    loadCatalog([f('pt-BR.lang', `${en}${T}${tr}\n`)], { appPhrases: [{ text: en, plural }] }).errors;
  it('when the translation uses a placeholder the English lacks then it is an error', () => {
    assert.deepEqual(check('Hello', 'Olá %s'), ['pt-BR.lang:1: "Hello" has placeholders "%s" in the translation that do not match the English ""']);
  });
  it('when the count differs then it is an error', () => {
    assert.equal(check('%s of %s', '%s de').length, 1);
    assert.equal(check('%s', '%s %s').length, 1);
  });
  it('when the type differs then it is an error', () => {
    assert.equal(check('%d items', '%s itens').length, 1);
  });
  it('when positional placeholders are reordered then it is fine', () => {
    assert.deepEqual(check('%s of %s', '%2$s de %1$s'), []);
    assert.deepEqual(check('%1$s of %2$s', '%2$s de %1$s'), []);
  });
  it('when a positional index does not exist in the English then it is an error', () => {
    assert.equal(check('%s', '%2$s').length, 1);
  });
  it('when %% is used then it is not a placeholder', () => {
    assert.deepEqual(check('100%% sure', '100%% certo'), []);
    assert.equal(check('100%% sure', '100% certo %s').length, 1);
  });
  it('when a plural form drops the number then it is fine, but an extra placeholder is not', () => {
    assert.deepEqual(check('%d file', 'Um arquivo', '%d files').length, 1); // wrong column count: needs 2
    const ok = loadCatalog([f('pt-BR.lang', `%d file${T}Um arquivo${T}%d arquivos\n`)], { appPhrases: [{ text: '%d file', plural: '%d files' }] });
    assert.deepEqual(ok.errors, []);
    const bad = loadCatalog([f('pt-BR.lang', `%d file${T}%d %s${T}%d arquivos\n`)], { appPhrases: [{ text: '%d file', plural: '%d files' }] });
    assert.equal(bad.errors.length, 1);
  });
  it('when the English is a phrase from the file with no phrase list then placeholders are still checked', () => {
    const c = loadCatalog([f('pt-BR.lang', `Hello${T}Olá %s\n`)]);
    assert.equal(c.errors.length, 1);
  });
});
