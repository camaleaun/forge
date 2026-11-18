// The portable loader (i18n_common.cpp) with a bundled language pack (`forge build --bundle-locale`), against the fake platform adapter.
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { encodeLang } from '../../../src/i18n/lang.ts';
import { generateProject, writeProjectFiles, RUNTIME_DIR } from '../../../src/gen/index.ts';
import type { I18nGenOptions } from '../../../src/gen/i18n-options.ts';
import { ROOT } from '../helpers.ts';
import { optionsFor, PT_PACK, pluralIr, sha256 } from './i18n-app.ts';

const compiler = ['clang++', 'g++', 'c++'].find((name) => spawnSync(name, ['--version']).status === 0);
const DE_PACK = encodeLang({ tag: 'de', app: 'hello', version: '0.1.0', entries: [{ text: 'Greet', forms: ['Grüßen'] }] });

let dir = '';
let work = '';
let cache = '';

function build(name: string, options: I18nGenOptions): string {
  const out = join(dir, name);
  mkdirSync(out);
  writeProjectFiles(generateProject(pluralIr(), 'macos', { i18n: options }), out);
  const flags = ['-std=c++20', '-Wall', '-Wextra', '-Werror', '-fno-exceptions', '-fno-rtti', '-I', out, '-I', RUNTIME_DIR];
  const http = options.packs.some((pack) => pack.tag !== options.bundle?.tag) && options.download ? [join(RUNTIME_DIR, 'http_common.cpp')] : [];
  const sources = [join(out, 'messages.cpp'), join(RUNTIME_DIR, 'i18n.cpp'), join(RUNTIME_DIR, 'i18n_common.cpp'), ...http, join(ROOT, 'test/gen/fixtures/platform_fake.cpp')];
  const binary = join(out, 'driver');
  const built = spawnSync(compiler as string, [...flags, ...sources, '-o', binary], { encoding: 'utf8' });
  assert.equal(built.status, 0, built.stderr);
  return binary;
}

const drive = (binary: string, script: string[], env: Record<string, string> = {}): string[] => {
  const result = spawnSync(binary, [], { input: script.join('\n') + '\n', encoding: 'utf8', env: { PATH: process.env.PATH ?? '', ...env }, timeout: 20000 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.split('\n').slice(0, -1);
};

describe('given a loader with pt-BR bundled and de downloadable', { skip: !compiler && 'no C++ compiler' }, () => {
  let variant = '';
  let tampered = '';
  const setup = (packfile = 'de.lang') => [`cachebase ${cache}`, `packfile ${join(dir, packfile)}`];

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'forge-i18n-bundled-'));
    const base = optionsFor();
    const de = { tag: 'de', file: 'hello-0.1.0-de.lang', sha256: sha256(DE_PACK), size: Buffer.byteLength(DE_PACK) };
    variant = build('variant', { ...base, packs: [...base.packs, de], bundle: { tag: 'pt-BR', text: PT_PACK } });
    tampered = build('tampered', { ...base, bundle: { tag: 'pt-BR', text: PT_PACK.replace('Cumprimentar', 'Cumprimentaar') } });
    writeFileSync(join(dir, 'de.lang'), DE_PACK);
  });
  after(() => rmSync(dir, { recursive: true, force: true }));
  beforeEach(() => {
    work = mkdtempSync(join(dir, 'case-'));
    cache = join(work, 'lang');
    mkdirSync(cache);
  });

  it('when the GUI starts with no cache and no network, then the bundled language is active, rendered from memory, with no download and no cache write', () => {
    const out = drive(variant, [...setup(), 'http fail', 'start', 'active', 'render Greet', 'jobs', 'urls', 'cache', 'offline pt-BR']);
    assert.deepEqual(out, ['pt-BR', 'Cumprimentar', '0', '', '', 'no']);
  });
  it('when the system languages are English or German, then the GUI still opens in the bundled language', () => {
    for (const system of ['en-US', 'en_US.UTF-8', 'de']) {
      assert.deepEqual(drive(variant, [...setup(), `syslang ${system}`, 'start', 'active']), ['pt-BR'], system);
    }
  });
  it('when FORGE_LOCALE_PREFERENCE is set, then it wins over the stored choice and the bundled default', () => {
    assert.deepEqual(drive(variant, [...setup(), 'set language pt-BR', 'start', 'active'], { FORGE_LOCALE_PREFERENCE: 'en' }), ['en']);
  });
  it('when English is stored by the dropdown, then it wins over the bundled default; choosing Auto goes back to the bundled language', () => {
    const out = drive(variant, [...setup(), 'start', 'choose en', 'active', 'stored', 'choose ', 'active', 'stored', 'render Greet', 'jobs', 'urls']);
    assert.deepEqual(out, ['en', 'en', 'pt-BR', '<auto>', 'Cumprimentar', '0', '']);
  });
  it('when the stored choice is the bundled language, then choosing it again needs no download', () => {
    assert.deepEqual(drive(variant, [...setup(), 'choose en', 'choose pt-BR', 'active', 'stored', 'jobs', 'urls', 'cache']), ['pt-BR', 'pt-BR', '0', '', '']);
  });
  it('when another language that is not bundled is chosen, then it still downloads as usual', () => {
    const out = drive(variant, [...setup(), 'start', 'choose de', 'pump', 'active', 'render Greet', 'urls', 'cache']);
    assert.deepEqual(out.slice(0, 3), ['de', 'Grüßen', 'https://github.com/camaleaun/forge-hello-world/releases/download/v0.1.0/hello-0.1.0-de.lang']);
    assert.match(out[3], /^de-[0-9a-f]{12}\.lang$/);
  });
  it('when the CLI runs, then --locale beats FORGE_LOCALE, which beats the stored choice, which beats the bundled default', () => {
    assert.deepEqual(drive(variant, [...setup(), 'cli en', 'active']), ['en']);
    assert.deepEqual(drive(variant, [...setup(), 'cli en', 'active'], { FORGE_LOCALE: 'pt-BR' }), ['en']);
    assert.deepEqual(drive(variant, [...setup(), 'cli -', 'active'], { FORGE_LOCALE: 'en' }), ['en']);
    assert.deepEqual(drive(variant, [...setup(), 'set language en', 'cli -', 'active']), ['en']);
    assert.deepEqual(drive(variant, [...setup(), 'cli -', 'active', 'render Greet', 'urls', 'cache']), ['pt-BR', 'Cumprimentar', '', '']);
  });
  it('when LC_ALL, LC_MESSAGES or LANG are English, then the CLI still uses the bundled language (they are system settings)', () => {
    assert.deepEqual(drive(variant, [...setup(), 'cli -', 'active'], { LC_ALL: 'en_US.UTF-8', LC_MESSAGES: 'en_US.UTF-8', LANG: 'en_US.UTF-8' }), ['pt-BR']);
  });
  it('when the bundled pack is fetched explicitly, then nothing is downloaded or cached', () => {
    assert.deepEqual(drive(variant, [...setup(), 'http fail', 'fetch pt-BR', 'urls', 'cache']), ['Language pack pt-BR installed', 'exit 0', '', '']);
    assert.deepEqual(readdirSync(cache), []);
  });
  it('when the bundled text does not match the sha256 pinned for its pack, then it is not used and English stays', () => {
    assert.deepEqual(drive(tampered, [...setup(), 'start', 'active', 'render Greet', 'cache']), ['en', 'Greet', '']);
  });
});
