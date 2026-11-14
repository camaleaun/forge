import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodeLang } from '../../../src/i18n/lang.ts';
import { buildApp, canRun, skipReason, optionsFor, PT_PACK, ptName, pluralIr, removeDir, run, sha256, tempDir, type App } from './i18n-app.ts';

let app: App;
let cache = '';
before(() => {
  if (canRun) app = buildApp(pluralIr(), optionsFor());
});
after(() => app?.dispose());
beforeEach(() => {
  cache = tempDir();
  mkdirSync(cache, { recursive: true });
  writeFileSync(join(cache, ptName()), PT_PACK);
});
afterEach(() => removeDir(cache));

const go = (args: string[], env: Record<string, string> = {}) => run(app, args, { FORGE_I18N_CACHE_DIR: cache, ...env });

describe('given an i18n app with the pt-BR pack in the cache', { skip: !canRun && skipReason }, () => {
  it('when run in an English locale, then --greet prints English', () => {
    const result = go(['--greet']);
    assert.equal(result.stdout, 'Hello, world!\n');
    assert.equal(result.status, 0);
  });
  it('when FORGE_LOCALE=pt_BR, then --greet prints Olá, mundo!', () => {
    assert.equal(go(['--greet'], { FORGE_LOCALE: 'pt_BR' }).stdout, 'Olá, mundo!\n');
  });
  it('when --locale pt-BR comes before the command, then the pack is used and the flag is not routed to commands', () => {
    const result = go(['--locale', 'pt-BR', '--greet']);
    assert.equal(result.stdout, 'Olá, mundo!\n');
    assert.equal(result.status, 0);
  });
  it('when --locale pt-BR comes after the command, then the pack is used', () => {
    assert.equal(go(['--greet', '--locale', 'pt-BR']).stdout, 'Olá, mundo!\n');
  });
  it('when --locale=pt-BR is written with an equals sign, then it works too', () => {
    assert.equal(go(['--locale=pt_BR', '--greet']).stdout, 'Olá, mundo!\n');
  });
  it('when LANG=pt_BR.UTF-8, then the codeset is ignored and the pack is used', () => {
    assert.equal(go(['--greet'], { LANG: 'pt_BR.UTF-8' }).stdout, 'Olá, mundo!\n');
  });
  it('when LC_ALL is English and LANG is pt_BR, then LC_ALL wins (English)', () => {
    assert.equal(go(['--greet'], { LC_ALL: 'en_US.UTF-8', LANG: 'pt_BR.UTF-8' }).stdout, 'Hello, world!\n');
  });
  it('when LC_MESSAGES is pt_BR and LANG is English, then LC_MESSAGES wins', () => {
    assert.equal(go(['--greet'], { LC_MESSAGES: 'pt_BR.UTF-8', LANG: 'en_US.UTF-8' }).stdout, 'Olá, mundo!\n');
  });
  it('when FORGE_LOCALE is English and LANG is pt_BR, then FORGE_LOCALE wins', () => {
    assert.equal(go(['--greet'], { FORGE_LOCALE: 'en', LANG: 'pt_BR.UTF-8' }).stdout, 'Hello, world!\n');
  });
  it('when --locale en is given with FORGE_LOCALE=pt_BR, then --locale wins', () => {
    assert.equal(go(['--locale', 'en', '--greet'], { FORGE_LOCALE: 'pt_BR' }).stdout, 'Hello, world!\n');
  });
  it('when the language is another Portuguese (pt-PT), then the pt-BR pack is used', () => {
    assert.equal(go(['--locale', 'pt-PT', '--greet']).stdout, 'Olá, mundo!\n');
  });
  it('when the language is unknown (xx), then the output is English and the exit code is 0', () => {
    const result = go(['--locale', 'xx', '--greet']);
    assert.equal(result.stdout, 'Hello, world!\n');
    assert.equal(result.status, 0);
  });
  it('when --locale has no value, then it fails with exit code 2 and says so', () => {
    const result = go(['--greet', '--locale']);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /--locale needs a language tag/);
  });
  it('when the old flag names are used (--lang, FORGE_LANG), then they are not recognized: the flag is an unknown option and the variable is ignored', () => {
    const flag = go(['--lang', 'pt-BR', '--greet']);
    assert.equal(flag.status, 2);
    assert.match(flag.stderr, /unknown option: --lang/);
    const env = go(['--greet'], { FORGE_LANG: 'pt-BR' });
    assert.equal(env.stdout, 'Hello, world!\n');
  });
  it('when --help runs in pt-BR, then command descriptions with a translation are translated and the rest stay English', () => {
    const result = go(['--help'], { FORGE_LOCALE: 'pt-BR' });
    assert.match(result.stdout, /--greet {2,}Mostra a saudação/);
    assert.match(result.stdout, /--files {2,}Show a count/);
    assert.match(result.stdout, /--version {2,}Print the version/);
  });
  it('when --version runs with --locale, then the version is printed as before', () => {
    assert.equal(go(['--locale', 'pt-BR', '--version']).stdout, '0.1.0\n');
  });
  it('when an unknown option follows --locale, then the exit code is 2', () => {
    assert.equal(go(['--locale', 'pt-BR', '--nope']).status, 2);
  });
  it('when only --locale pt-BR is given, then the UI entry point runs', () => {
    assert.equal(go(['--locale', 'pt-BR']).stdout, 'ui\n');
  });
});

describe('given a cache that cannot be trusted', { skip: !canRun && skipReason }, () => {
  it('when the cached file is corrupted, then it is ignored (English) and deleted', () => {
    writeFileSync(join(cache, ptName()), PT_PACK.replace('Olá', 'Oi'));
    const result = go(['--locale', 'pt-BR', '--greet']);
    assert.equal(result.stdout, 'Hello, world!\n');
    assert.equal(result.status, 0);
    assert.ok(!existsSync(join(cache, ptName())));
  });
  it('when the cached file is empty or not a pack, then it is ignored too', () => {
    writeFileSync(join(cache, ptName()), '');
    assert.equal(go(['--locale', 'pt-BR', '--greet']).stdout, 'Hello, world!\n');
  });
  it('when there is no cache at all, then the CLI never downloads: English', () => {
    removeDir(cache);
    const result = go(['--locale', 'pt-BR', '--greet'], { FORGE_I18N_BASE_URL: 'http://127.0.0.1:9/' });
    assert.equal(result.stdout, 'Hello, world!\n');
    assert.equal(result.status, 0);
  });
});

describe('given plural and context messages', { skip: !canRun && skipReason }, () => {
  const lines = (env: Record<string, string>) => [0, 1, 3].map((n) => go([`--files${n}`], env).stdout.trim());
  it('when run in English, then 0 and 3 are plural and 1 is singular', () => {
    assert.deepEqual(lines({}), ['0 files', '1 file', '3 files']);
  });
  it('when run in pt-BR, then 0 and 1 are singular and 3 is plural', () => {
    assert.deepEqual(lines({ FORGE_LOCALE: 'pt-BR' }), ['0 arquivo', '1 arquivo', '3 arquivos']);
  });
  it('when the same text has two contexts, then each context has its own translation', () => {
    assert.equal(go(['--post'], { FORGE_LOCALE: 'pt-BR' }).stdout, 'Postagem\n');
    assert.equal(go(['--postverb'], { FORGE_LOCALE: 'pt-BR' }).stdout, 'Publicar\n');
    assert.equal(go(['--postverb']).stdout, 'Post\n');
  });
});

describe('given a pack that translates only the greeting', { skip: !canRun && skipReason }, () => {
  it('when a plural message has no entry, then the English plural rule applies (singular only for 1)', () => {
    const pack = encodeLang({ tag: 'pt-BR', app: 'hello', version: '0.1.0', entries: [{ text: 'Hello, world!', forms: ['Olá, mundo!'] }] });
    const small = buildApp(pluralIr(), optionsFor({ packs: [{ tag: 'pt-BR', file: 'x.lang', sha256: sha256(pack), size: Buffer.byteLength(pack) }] }));
    const dir = tempDir();
    try {
      writeFileSync(join(dir, ptName(sha256(pack))), pack);
      const env = { FORGE_I18N_CACHE_DIR: dir, FORGE_LOCALE: 'pt-BR' };
      assert.equal(run(small, ['--greet'], env).stdout, 'Olá, mundo!\n');
      assert.deepEqual([0, 1, 3].map((n) => run(small, [`--files${n}`], env).stdout.trim()), ['0 files', '1 file', '3 files']);
    } finally {
      removeDir(dir);
      small.dispose();
    }
  });
});
