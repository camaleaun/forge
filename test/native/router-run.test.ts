import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateAppHeader } from '../../src/generate/app-header.ts';
import { generateActionsCpp } from '../../src/generate/actions-cpp.ts';
import { generateCliRouter } from '../../src/generate/cli-router.ts';
import { hello } from '../helpers/fixtures.ts';

const hasClang = spawnSync('clang++', ['--version']).status === 0;
const root = new URL('../../', import.meta.url).pathname;
const effects = { greet: [{ op: 'setText' as const, target: 'message', text: 'Hello, world!' }] };
let dir = '';
let binary = '';

function run(...args: string[]) {
  return spawnSync(binary, args, { encoding: 'utf8' });
}

describe('given the hello app linked with a stub UI', { skip: !hasClang && 'clang++ not installed' }, () => {
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'forge-run-'));
    writeFileSync(join(dir, 'forge_app.hpp'), generateAppHeader(hello(), ['greet']));
    writeFileSync(join(dir, 'actions.cpp'), generateActionsCpp(effects));
    writeFileSync(join(dir, 'cli_router.cpp'), generateCliRouter(hello()));
    binary = join(dir, 'hello');
    const build = spawnSync('clang++', [
      '-std=c++20', '-Wall', '-Wextra', '-Werror', '-I', dir, '-I', join(root, 'runtime'),
      join(root, 'runtime/main.cpp'), join(dir, 'actions.cpp'), join(dir, 'cli_router.cpp'),
      join(root, 'test/fixtures/native/ui_stub.cpp'), '-o', binary,
    ], { encoding: 'utf8' });
    assert.equal(build.stderr, '');
    assert.equal(build.status, 0);
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('when run with --greet, then stdout is the greeting and the exit code is 0', () => {
    const result = run('--greet');
    assert.equal(result.stdout, 'Hello, world!\n');
    assert.equal(result.status, 0);
  });

  it('when run with --version, then stdout is the version from the spec', () => {
    const result = run('--version');
    assert.equal(result.stdout, '0.1.0\n');
    assert.equal(result.status, 0);
  });

  it('when run with no arguments, then the UI entry point runs', () => {
    assert.equal(run().stdout, 'ui\n');
  });

  it('when run with only the -psn_ argument that Finder passes, then the UI entry point runs', () => {
    assert.equal(run('-psn_0_12345').stdout, 'ui\n');
  });

  it('when run with an unknown option, then the exit code is 2 and stderr points to --help', () => {
    const result = run('--nope');
    assert.equal(result.status, 2);
    assert.match(result.stderr, /unknown option: --nope \(see --help\)/);
  });
});
