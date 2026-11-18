import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateProject, writeProjectFiles, RUNTIME_DIR, runtimeFilesFor } from '../../../src/gen/index.ts';
import type { I18nGenOptions } from '../../../src/gen/i18n-options.ts';
import { helloI18nIr } from '../helpers.ts';
import { optionsFor, PT_PACK } from './i18n-app.ts';

const canBuild = process.platform === 'darwin' && spawnSync('cmake', ['--version']).status === 0;
const dirs: string[] = [];
// The bundle id (and so the defaults domain) is local.forge.<name>: a name no real app uses.
const NAME = 'forgebundledtest';
const APP_ID = `local.forge.${NAME}`;
const HOME = process.env.HOME ?? '';

function build(options: I18nGenOptions, cmakeArgs: string[] = []): { exe: string; dir: string } {
  const ir = helloI18nIr();
  ir.app.name = NAME;
  const dir = mkdtempSync(join(tmpdir(), 'forge-gen-bundled-'));
  dirs.push(dir);
  writeProjectFiles(generateProject(ir, 'macos', { i18n: options }), dir);
  for (const file of runtimeFilesFor(options, 'macos', ir)) copyFileSync(join(RUNTIME_DIR, file), join(dir, file));
  const configure = spawnSync('cmake', ['-S', dir, '-B', join(dir, 'build'), '-G', 'Unix Makefiles', ...cmakeArgs], { encoding: 'utf8' });
  assert.equal(configure.status, 0, configure.stdout + configure.stderr);
  const made = spawnSync('cmake', ['--build', join(dir, 'build')], { encoding: 'utf8' });
  assert.equal(made.status, 0, made.stdout + made.stderr);
  return { exe: join(dir, `build/${NAME}.app/Contents/MacOS/${NAME}`), dir };
}

let variant = '';
let variantDir = '';
let plain = '';
let emptyCache = '';

// No cache, no pack server; only what the test sets.
const run = (args: string[], env: Record<string, string> = {}) =>
  spawnSync(variant, args, { encoding: 'utf8', env: { HOME, FORGE_I18N_CACHE_DIR: emptyCache, FORGE_I18N_BASE_URL: 'http://127.0.0.1:9/', ...env } });
const defaults = (...args: string[]) => spawnSync('defaults', args, { encoding: 'utf8' });

describe('given a language variant built with cmake (pt-BR bundled)', { skip: !canBuild && 'needs macOS and cmake' }, () => {
  before(() => {
    const options = optionsFor({ menu: false, appId: APP_ID });
    ({ exe: variant, dir: variantDir } = build({ ...options, bundle: { tag: 'pt-BR', text: PT_PACK } }, ['-DFORGE_VARIANT=pt-BR']));
    plain = build(options).exe;
    emptyCache = mkdtempSync(join(tmpdir(), 'forge-gen-bundled-cache-'));
    dirs.push(emptyCache);
  });
  after(() => {
    defaults('delete', APP_ID);
    dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true }));
  });

  it('when run with --greet, no cache and no network, then it prints the Portuguese greeting and writes nothing to the cache', () => {
    const result = run(['--greet'], { LANG: 'en_US.UTF-8' });
    assert.equal(result.stdout, 'Olá, mundo!\n');
    assert.equal(result.status, 0);
    assert.deepEqual(readdirSync(emptyCache), []);
  });
  it('when run with LC_ALL, LC_MESSAGES and LANG set to English, then the variant does not change', () => {
    assert.equal(run(['--greet'], { LC_ALL: 'en_US.UTF-8', LC_MESSAGES: 'en_US.UTF-8', LANG: 'en_US.UTF-8' }).stdout, 'Olá, mundo!\n');
  });
  it('when run with --locale en, then it prints English; FORGE_LOCALE does the same and --locale wins over it', () => {
    assert.equal(run(['--locale', 'en', '--greet']).stdout, 'Hello, world!\n');
    assert.equal(run(['--greet'], { FORGE_LOCALE: 'en' }).stdout, 'Hello, world!\n');
    assert.equal(run(['--locale', 'pt-BR', '--greet'], { FORGE_LOCALE: 'en' }).stdout, 'Olá, mundo!\n');
  });
  it('when FORGE_LOCALE_PREFERENCE or the stored choice is English, then the CLI follows them, and --locale still wins', () => {
    assert.equal(run(['--greet'], { FORGE_LOCALE_PREFERENCE: 'en' }).stdout, 'Hello, world!\n');
    assert.equal(defaults('write', APP_ID, 'ForgeLanguage', 'en').status, 0);
    assert.equal(run(['--greet']).stdout, 'Hello, world!\n');
    assert.equal(run(['--locale', 'pt-BR', '--greet']).stdout, 'Olá, mundo!\n');
    defaults('delete', APP_ID);
    assert.equal(run(['--greet']).stdout, 'Olá, mundo!\n');
  });
  it('when inspected, then the variant carries no HTTP client', () => {
    const symbols = spawnSync('nm', ['-u', variant], { encoding: 'utf8' }).stdout + spawnSync('strings', [variant], { encoding: 'utf8' }).stdout;
    assert.doesNotMatch(symbols, /NSURLSession/);
  });
  it('when configured with -DFORGE_VARIANT=pt-BR, then CPack names the dmg with the suffix and the package name is unchanged', () => {
    const config = readFileSync(join(variantDir, 'build/CPackConfig.cmake'), 'utf8');
    assert.match(config, new RegExp(`set\\(CPACK_PACKAGE_FILE_NAME "${NAME}-0\\.1\\.0-Darwin-pt-BR"\\)`));
    assert.match(config, new RegExp(`set\\(CPACK_PACKAGE_NAME "${NAME}"\\)`));
  });
  it('when the sizes are measured, then the variant is smaller than the default i18n hello (both are printed)', () => {
    const [a, b] = [statSync(variant).size, statSync(plain).size];
    console.log(`# hello pt-BR variant (bundled, no HTTP): ${a} bytes; default i18n hello: ${b} bytes; delta ${a - b} bytes`);
    assert.ok(a < b);
  });
});
