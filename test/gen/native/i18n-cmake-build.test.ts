import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateProject, writeProjectFiles, RUNTIME_DIR, RUNTIME_FILES, runtimeFilesFor } from '../../../src/gen/index.ts';
import type { I18nGenOptions } from '../../../src/gen/i18n-options.ts';
import type { Ir } from '../../../src/ir/types.ts';
import { helloI18nIr, helloIr } from '../helpers.ts';
import { optionsFor, PT_PACK, ptName } from './i18n-app.ts';

const canBuild = process.platform === 'darwin' && spawnSync('cmake', ['--version']).status === 0;
// The i18n hello (with the language-download bar) is about 128 KB: arm64 macOS pads segments to 16 KB pages, so a few
// hundred bytes of code can move the file by a whole page.
const MAX_I18N_BYTES = 136 * 1024;
const dirs: string[] = [];

function build(ir: Ir, i18n: I18nGenOptions | undefined): string {
  const dir = mkdtempSync(join(tmpdir(), 'forge-gen-i18n-cmake-'));
  dirs.push(dir);
  writeProjectFiles(generateProject(ir, 'macos', { i18n }), dir);
  for (const file of runtimeFilesFor(i18n)) copyFileSync(join(RUNTIME_DIR, file), join(dir, file));
  const configure = spawnSync('cmake', ['-S', dir, '-B', join(dir, 'build'), '-G', 'Unix Makefiles'], { encoding: 'utf8' });
  assert.equal(configure.status, 0, configure.stdout + configure.stderr);
  const made = spawnSync('cmake', ['--build', join(dir, 'build')], { encoding: 'utf8' });
  assert.equal(made.status, 0, made.stdout + made.stderr);
  return join(dir, 'build/hello.app/Contents/MacOS/hello');
}

let withI18n = '';
let without = '';
let cacheDir = '';

describe('given an i18n hello built with cmake', { skip: !canBuild && 'needs macOS and cmake' }, () => {
  before(() => {
    withI18n = build(helloI18nIr(), optionsFor({ menu: false }));
    without = build(helloIr(), undefined);
    cacheDir = mkdtempSync(join(tmpdir(), 'forge-gen-i18n-cache-'));
    dirs.push(cacheDir);
    writeFileSync(join(cacheDir, ptName()), PT_PACK);
  });
  after(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  it('when built with cmake (-Os, dead_strip), then the bundle has the executable', () => {
    assert.ok(existsSync(withI18n));
  });
  it('when run with --greet in English, then it prints the greeting', () => {
    const result = spawnSync(withI18n, ['--greet'], { encoding: 'utf8', env: { LANG: 'en_US.UTF-8', HOME: process.env.HOME ?? '' } });
    assert.equal(result.stdout, 'Hello, world!\n');
  });
  it('when run with --lang pt-BR and a cached pack, then it prints the Portuguese greeting', () => {
    const result = spawnSync(withI18n, ['--lang', 'pt-BR', '--greet'], { encoding: 'utf8', env: { FORGE_I18N_CACHE_DIR: cacheDir, HOME: process.env.HOME ?? '' } });
    assert.equal(result.stdout, 'Olá, mundo!\n');
    assert.equal(result.status, 0);
  });
  it('when the sizes are measured, then the i18n hello is under 136 KB (both are printed)', () => {
    const [a, b] = [statSync(withI18n).size, statSync(without).size];
    console.log(`# hello with i18n (menu off, dropdown): ${a} bytes; without i18n: ${b} bytes; delta ${a - b} bytes`);
    assert.ok(a < MAX_I18N_BYTES, `${a} bytes is not under ${MAX_I18N_BYTES}`);
  });
  it('when the plain app is generated, then neither its sources nor its runtime files mention i18n', () => {
    assert.deepEqual(runtimeFilesFor(undefined), RUNTIME_FILES);
    assert.ok(!(generateProject(helloIr(), 'macos').get('CMakeLists.txt') as string).includes('i18n'));
  });
});
