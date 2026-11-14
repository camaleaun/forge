import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateAppHeader } from '../../src/generate/app-header.ts';
import { generateActionsCpp } from '../../src/generate/actions-cpp.ts';
import { generateCliRouter } from '../../src/generate/cli-router.ts';
import { generateMacosUi } from '../../src/generate/macos.ts';
import { hello } from '../helpers/fixtures.ts';

const hasClang = spawnSync('clang++', ['--version']).status === 0;
const effects = { greet: [{ op: 'setText' as const, target: 'message', text: 'Hello, world!' }] };
let dir = '';

function syntaxCheck(file: string, extra: string[] = []) {
  return spawnSync('clang++', ['-std=c++20', '-Wall', '-Wextra', '-Werror', '-fsyntax-only', '-I', dir, ...extra, join(dir, file)], { encoding: 'utf8' });
}

describe('given the generated hello sources', { skip: !hasClang && 'clang++ not installed' }, () => {
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'forge-syntax-'));
    writeFileSync(join(dir, 'forge_app.hpp'), generateAppHeader(hello(), ['greet']));
    writeFileSync(join(dir, 'actions.cpp'), generateActionsCpp(effects));
    writeFileSync(join(dir, 'cli_router.cpp'), generateCliRouter(hello()));
    writeFileSync(join(dir, 'ui_macos.mm'), generateMacosUi(hello()));
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  for (const file of ['actions.cpp', 'cli_router.cpp']) {
    it(`when ${file} is compiled with clang++ -fsyntax-only, then clang accepts it without warnings`, () => {
      const result = syntaxCheck(file);
      assert.equal(result.stderr, '');
      assert.equal(result.status, 0);
    });
  }

  it('when ui_macos.mm is compiled as Objective-C++ with ARC, then clang accepts it', { skip: process.platform !== 'darwin' && 'macOS only' }, () => {
    const result = syntaxCheck('ui_macos.mm', ['-x', 'objective-c++', '-fobjc-arc', '-Wno-deprecated-declarations']);
    assert.equal(result.stderr, '');
    assert.equal(result.status, 0);
  });
});
