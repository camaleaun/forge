import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateProject, writeProjectFiles, RUNTIME_DIR } from '../../../src/gen/index.ts';
import { helloI18nIr, helloI18nOptions, variantsI18nIr } from '../helpers.ts';

const hasClang = spawnSync('clang++', ['--version']).status === 0;
const FLAGS = ['-std=c++20', '-Wall', '-Wextra', '-Werror', '-fno-exceptions', '-fno-rtti', '-fsyntax-only'];
const MM_FLAGS = ['-x', 'objective-c++', '-fobjc-arc'];

for (const [label, make, menu] of [['hello, Language menu on', helloI18nIr, true], ['hello, Language menu off', helloI18nIr, false], ['hello with @media variants', variantsI18nIr, false]] as const) {
  describe(`given the generated i18n ${label} sources`, { skip: !hasClang && 'clang++ not installed' }, () => {
    let dir = '';
    before(() => {
      dir = mkdtempSync(join(tmpdir(), 'forge-gen-i18n-syntax-'));
      writeProjectFiles(generateProject(make(), 'macos', { i18n: helloI18nOptions({ menu }) }), dir);
    });
    after(() => rmSync(dir, { recursive: true, force: true }));

    for (const file of ['actions.cpp', 'cli_router.cpp', 'messages.cpp']) {
      it(`when ${file} is compiled with -fsyntax-only -Wall -Wextra -Werror, then clang accepts it`, () => {
        const result = spawnSync('clang++', [...FLAGS, '-I', dir, '-I', RUNTIME_DIR, join(dir, file)], { encoding: 'utf8' });
        assert.equal(result.stderr, '');
        assert.equal(result.status, 0);
      });
    }
    it('when ui_macos.mm is compiled as Objective-C++ with ARC, then clang accepts it', { skip: process.platform !== 'darwin' && 'macOS only' }, () => {
      const result = spawnSync('clang++', [...FLAGS, ...MM_FLAGS, '-I', dir, '-I', RUNTIME_DIR, join(dir, 'ui_macos.mm')], { encoding: 'utf8' });
      assert.equal(result.stderr, '');
      assert.equal(result.status, 0);
    });
  });
}

describe('given the hand-written i18n runtime files', { skip: process.platform !== 'darwin' && 'macOS only' }, () => {
  it('when i18n_macos.mm is compiled with ARC and the strict flags, then clang accepts it', () => {
    const result = spawnSync('clang++', [...FLAGS, ...MM_FLAGS, '-I', RUNTIME_DIR, join(RUNTIME_DIR, 'i18n_macos.mm')], { encoding: 'utf8' });
    assert.equal(result.stderr, '');
    assert.equal(result.status, 0);
  });
});
