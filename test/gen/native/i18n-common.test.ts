// The portable loader (i18n_common.cpp) against a fake platform adapter: runs on any machine with a C++ compiler.
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateProject, writeProjectFiles, RUNTIME_DIR } from '../../../src/gen/index.ts';
import { ROOT } from '../helpers.ts';
import { optionsFor, PT_PACK, ptName, pluralIr, sha256 } from './i18n-app.ts';

const compiler = ['clang++', 'g++', 'c++'].find((name) => spawnSync(name, ['--version']).status === 0);

let dir = '';
let driver = '';
let work = '';
let cache = '';
let packFile = '';

// Runs the driver with the script and returns its output lines.
function drive(script: string[], env: Record<string, string> = {}): string[] {
  const result = spawnSync(driver, [], { input: script.join('\n') + '\n', encoding: 'utf8', env: { PATH: process.env.PATH ?? '', ...env }, timeout: 20000 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.split('\n').slice(0, -1);
}
const setup = () => [`cachebase ${cache}`, `packfile ${packFile}`];

describe('given the portable language loader and a fake platform adapter', { skip: !compiler && 'no C++ compiler' }, () => {
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'forge-i18n-common-'));
    writeProjectFiles(generateProject(pluralIr(), 'macos', { i18n: optionsFor() }), dir);
    const flags = ['-std=c++20', '-Wall', '-Wextra', '-Werror', '-fno-exceptions', '-fno-rtti', '-I', dir, '-I', RUNTIME_DIR];
    const sources = [join(dir, 'messages.cpp'), join(RUNTIME_DIR, 'i18n.cpp'), join(RUNTIME_DIR, 'i18n_common.cpp'), join(ROOT, 'test/gen/fixtures/platform_fake.cpp')];
    driver = join(dir, 'driver');
    const built = spawnSync(compiler as string, [...flags, ...sources, '-o', driver], { encoding: 'utf8' });
    assert.equal(built.status, 0, built.stderr);
    packFile = join(dir, 'pt.lang');
    writeFileSync(packFile, PT_PACK);
  });
  after(() => rmSync(dir, { recursive: true, force: true }));
  beforeEach(() => {
    work = mkdtempSync(join(dir, 'case-'));
    cache = join(work, 'lang');
    mkdirSync(cache);
  });

  it('when a language is stored and its pack is cached, then the GUI applies it at start without a download', () => {
    const out = drive([...setup(), 'plant ' + ptName() + ' ' + packFile, 'set language pt-BR', 'start', 'active', 'render Greet', 'urls']);
    assert.deepEqual(out, ['pt-BR', 'Cumprimentar', '']);
  });
  it('when FORGE_LANG_PREFERENCE is set, then it wins over the stored language', () => {
    const out = drive([...setup(), 'plant ' + ptName() + ' ' + packFile, 'set language en', 'start', 'active'], { FORGE_LANG_PREFERENCE: 'pt-BR' });
    assert.deepEqual(out, ['pt-BR']);
  });
  it('when the system language is pt_BR.UTF-8, then the pt-BR pack is chosen', () => {
    const out = drive([...setup(), 'plant ' + ptName() + ' ' + packFile, 'syslang pt_BR.UTF-8', 'start', 'active']);
    assert.deepEqual(out, ['pt-BR']);
  });
  it('when the system language has no pack, then English stays active', () => {
    assert.deepEqual(drive([...setup(), 'syslang xx-XX', 'start', 'active', 'jobs']), ['en', '0']);
  });
  it('when the pack is missing, then it is downloaded in the background, applied by the refresh and stored', () => {
    const out = drive([...setup(), 'hook', 'syslang en', 'choose pt-BR', 'active', 'pump', 'active', 'stored', 'cache', 'render Greet']);
    assert.deepEqual(out, ['hook', 'en', 'hook', 'hook', 'hook', 'pt-BR', 'pt-BR', ptName(), 'Cumprimentar']);
  });
  it('when the download fails, then the language is marked offline and nothing is stored', () => {
    const out = drive([...setup(), 'hook', 'http fail', 'choose pt-BR', 'pump', 'offline pt-BR', 'active', 'stored']);
    assert.deepEqual(out, ['hook', 'hook', 'yes', 'en', '<auto>']);
  });
  it('when an offline language is chosen again, then no new download is attempted', () => {
    const out = drive([...setup(), 'http fail', 'choose pt-BR', 'pump', 'choose pt-BR', 'jobs']);
    assert.deepEqual(out, ['0']);
  });
  it('when the server answers 404, then it is offline too', () => {
    assert.deepEqual(drive([...setup(), 'http status404', 'choose pt-BR', 'pump', 'offline pt-BR']), ['yes']);
  });
  it('when the download is disabled by the user setting, then the language is offline at once, with no job', () => {
    assert.deepEqual(drive([...setup(), 'set download false', 'choose pt-BR', 'jobs', 'offline pt-BR']), ['0', 'yes']);
  });
  it('when the pack on the server has another checksum, then it is rejected and not cached', () => {
    writeFileSync(join(work, 'bad.lang'), PT_PACK.replace('Cumprimentar', 'Cumprimentaar'));
    const out = drive([`cachebase ${cache}`, `packfile ${join(work, 'bad.lang')}`, 'choose pt-BR', 'pump', 'offline pt-BR', 'cache']);
    assert.deepEqual(out, ['yes', '']);
  });
  it('when choosing English, then it is stored and the language is applied at once', () => {
    assert.deepEqual(drive([...setup(), 'choose en', 'stored', 'active']), ['en', 'en']);
  });
  it('when choosing Auto (empty), then the stored choice is removed and the system language is used', () => {
    const out = drive([...setup(), 'plant ' + ptName() + ' ' + packFile, 'set language en', 'syslang pt-BR', 'choose ', 'stored', 'active']);
    assert.deepEqual(out, ['<auto>', 'pt-BR']);
  });
  it('when the cache has an older pack of the same language and another language, then only the older same-language one is pruned', () => {
    const old = 'pt-BR-aaaaaaaaaaaa.lang';
    const other = 'de-bbbbbbbbbbbb.lang';
    const out = drive([...setup(), 'plantjunk ' + old, 'plantjunk ' + other, 'choose pt-BR', 'pump', 'cache']);
    assert.deepEqual(out, [[other, ptName()].sort().join(',')]);
  });
  it('when a cached file is corrupted, then it is deleted and ignored', () => {
    const out = drive([...setup(), 'plantjunk ' + ptName(), 'cli pt-BR', 'active', 'cache']);
    assert.deepEqual(out, ['en', '']);
  });
  it('when the CLI language is read, then --lang beats FORGE_LANG, and the cache is never downloaded into', () => {
    const out = drive([...setup(), 'plant ' + ptName() + ' ' + packFile, 'cli pt-BR', 'active', 'urls'], { FORGE_LANG: 'en' });
    assert.deepEqual(out, ['pt-BR', '']);
  });
  it('when a download redirects to plain http on another host, then the redirect is refused', () => {
    const out = drive([...setup(), 'http redirect-http', 'fetch pt-BR', 'hops', 'cache']);
    assert.deepEqual(out, ['exit 1', 'http://evil.example/pack.lang', '']);
  });
  it('when the base URL is http on a non-loopback host, then the download is refused before the adapter is called', () => {
    const out = drive([...setup(), 'fetch pt-BR', 'urls'], { FORGE_I18N_BASE_URL: 'http://example.com/' });
    assert.deepEqual(out, ['exit 1', '']);
  });
  it('when the base URL is loopback http or https, then the adapter gets the pack URL', () => {
    assert.deepEqual(drive([...setup(), 'fetch pt-BR', 'urls'], { FORGE_I18N_BASE_URL: 'http://[::1]:8080/x/' }).slice(2), ['http://[::1]:8080/x/hello-0.1.0-pt-BR.lang']);
    rmSync(join(cache, ptName()));
    assert.deepEqual(drive([...setup(), 'fetch pt-BR', 'urls'], { FORGE_I18N_BASE_URL: 'https://example.com/x/' }).slice(2), ['https://example.com/x/hello-0.1.0-pt-BR.lang']);
  });
  it('when the base URL hides another host behind user info, then it is refused', () => {
    const out = drive([...setup(), 'fetch pt-BR', 'urls'], { FORGE_I18N_BASE_URL: 'http://127.0.0.1@evil.example/' });
    assert.deepEqual(out, ['exit 1', '']);
  });
  it('when FORGE_I18N_CACHE_DIR is set, then it overrides the adapter cache base', () => {
    const other = join(work, 'other');
    mkdirSync(other);
    const out = drive([...setup(), 'fetch pt-BR', 'cache'], { FORGE_I18N_CACHE_DIR: other });
    assert.deepEqual(out, ['Language pack pt-BR installed', 'exit 0', '']);
    assert.ok(readdirSync(other).includes(ptName()));
    assert.ok(!existsSync(join(cache, ptName())));
  });
  it('when the cache directory does not exist yet, then the download creates it (with parents)', () => {
    const deep = join(work, 'a', 'b', 'lang');
    assert.deepEqual(drive([`cachebase ${deep}`, `packfile ${packFile}`, 'fetch pt-BR']), ['Language pack pt-BR installed', 'exit 0']);
    assert.ok(existsSync(join(deep, ptName())));
  });
  it('when the sha256 helper agrees with the pinned hash, then the cache name uses its first 12 hex digits', () => {
    assert.equal(ptName(), `pt-BR-${sha256(PT_PACK).slice(0, 12)}.lang`);
  });

  describe('and a language download in flight', () => {
    const started = () => [...setup(), 'hook', 'syslang en', 'choose pt-BR'];
    it('when the download starts, then it is active at 0% and the hook runs so that a bar can show up', () => {
      assert.deepEqual(drive([...started(), 'active-download', 'progress pt-BR']), ['hook', 'yes', '0']);
    });
    it('when nothing is downloading, then it is not active and the progress is -1', () => {
      assert.deepEqual(drive([...setup(), 'active-download', 'progress pt-BR']), ['no', '-1']);
    });
    it('when the worker reports 0%, 50% and 100%, then 0% is already shown and each later post updates the main thread and runs the hook', () => {
      const out = drive([...started(), 'work', 'posts', 'progress pt-BR', 'post', 'progress pt-BR', 'post', 'progress pt-BR']);
      assert.deepEqual(out, ['hook', '2', '0', 'hook', '50', 'hook', '100']);
    });
    it('when the download succeeds, then the progress is gone, the bar is no longer needed and the pack applies', () => {
      const out = drive([...started(), 'work', 'post', 'post', 'done', 'active-download', 'progress pt-BR', 'active']);
      assert.deepEqual(out, ['hook', 'hook', 'hook', 'hook', 'no', '-1', 'pt-BR']);
    });
    it('when the connection breaks at 50%, then the progress is gone and the language is offline', () => {
      const out = drive([...started(), 'http failhalf', 'work', 'posts', 'post', 'progress pt-BR', 'done', 'active-download', 'progress pt-BR', 'offline pt-BR']);
      assert.deepEqual(out, ['hook', '1', 'hook', '50', 'hook', 'no', '-1', 'yes']);
    });
    it('when the server sends no Content-Length, then the total is the pack size known by the binary', () => {
      const out = drive([...started(), 'http nolength', 'work', 'progress pt-BR', 'post', 'progress pt-BR', 'post', 'progress pt-BR']);
      assert.deepEqual(out, ['hook', '0', 'hook', '50', 'hook', '100']);
    });
    it('when a progress post arrives after the download ended, then it is ignored (no hook, no progress)', () => {
      const out = drive([...started(), 'work', 'done', 'post', 'post', 'progress pt-BR']);
      assert.deepEqual(out, ['hook', 'hook', '-1']);
    });
    it('when progress is asked with an empty tag, then it is the download in flight', () => {
      assert.deepEqual(drive([...started(), 'work', 'post', 'progress']), ['hook', 'hook', '50']);
    });
  });
});
