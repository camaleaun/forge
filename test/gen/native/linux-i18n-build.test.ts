import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateProject, writeProjectFiles, RUNTIME_DIR, runtimeFilesFor } from '../../../src/gen/index.ts';
import { helloI18nIr } from '../helpers.ts';
import { optionsFor, PT_PACK, ptName } from './i18n-app.ts';

const has = (command: string, args: string[]) => spawnSync(command, args).status === 0;
const gtk = spawnSync('pkg-config', ['--cflags', 'gtk4'], { encoding: 'utf8' });
const canBuild = process.platform === 'linux' && has('cmake', ['--version']) && has('pkg-config', ['--exists', 'gtk4', 'libsoup-3.0']);
const SKIP = 'needs Linux, cmake and the gtk4 and libsoup-3.0 development files';
const MAX_BINARY_BYTES = 150 * 1024;
let dir = '';
let cache = '';
let binary = '';

describe('given the generated i18n hello sources', { skip: !(has('c++', ['--version']) && gtk.status === 0) && 'needs a C++ compiler and the gtk4 development files' }, () => {
  it('when ui_linux.cpp is compiled with -fsyntax-only, then the compiler accepts it without warnings', () => {
    const syntaxDir = mkdtempSync(join(tmpdir(), 'forge-gen-linux-i18n-syntax-'));
    try {
      writeProjectFiles(generateProject(helloI18nIr(), 'linux', { i18n: optionsFor() }), syntaxDir);
      const result = spawnSync('c++', ['-std=c++20', '-Wall', '-Wextra', '-Werror', '-fsyntax-only', '-I', syntaxDir, '-I', RUNTIME_DIR, ...gtk.stdout.trim().split(/\s+/), join(syntaxDir, 'ui_linux.cpp')], { encoding: 'utf8' });
      assert.equal(result.stderr, '');
      assert.equal(result.status, 0);
    } finally {
      rmSync(syntaxDir, { recursive: true, force: true });
    }
  });
});

describe('given a generated i18n hello project on Linux', { skip: !canBuild && SKIP }, () => {
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'forge-gen-linux-i18n-cmake-'));
    const options = optionsFor();
    writeProjectFiles(generateProject(helloI18nIr(), 'linux', { i18n: options }), dir);
    for (const file of runtimeFilesFor(options, 'linux')) copyFileSync(join(RUNTIME_DIR, file), join(dir, file));
    const configure = spawnSync('cmake', ['-S', dir, '-B', join(dir, 'build'), '-G', 'Unix Makefiles'], { encoding: 'utf8' });
    assert.equal(configure.status, 0, configure.stdout + configure.stderr);
    const build = spawnSync('cmake', ['--build', join(dir, 'build')], { encoding: 'utf8' });
    assert.equal(build.status, 0, build.stdout + build.stderr);
    binary = join(dir, 'build/hello');
    cache = mkdtempSync(join(tmpdir(), 'forge-gen-linux-i18n-cache-'));
    writeFileSync(join(cache, ptName()), PT_PACK);
  });
  after(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
  });

  it('when run with --lang pt-BR --greet and a cached pack, then it prints Olá, mundo!', () => {
    const result = spawnSync(binary, ['--lang', 'pt-BR', '--greet'], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', FORGE_I18N_CACHE_DIR: cache } });
    assert.equal(result.stdout, 'Olá, mundo!\n');
    assert.equal(result.status, 0);
  });
  it('when run with --greet in English, then it prints the greeting', () => {
    const result = spawnSync(binary, ['--greet'], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', LANG: 'en_US.UTF-8' } });
    assert.equal(result.stdout, 'Hello, world!\n');
  });
  it('when its size is measured, then it is under 150 KB (printed)', () => {
    const size = statSync(binary).size;
    console.log(`# hello Linux i18n binary size: ${size} bytes`);
    assert.ok(size < MAX_BINARY_BYTES, `${size} bytes is not under ${MAX_BINARY_BYTES}`);
  });
  it('when its libraries are listed, then libsoup-3 and gtk-4 are linked', () => {
    const ldd = spawnSync('ldd', [binary], { encoding: 'utf8' }).stdout;
    assert.match(ldd, /libsoup-3/);
    assert.match(ldd, /libgtk-4/);
  });
});
