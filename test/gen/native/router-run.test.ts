import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateProject, writeProjectFiles, RUNTIME_DIR } from '../../../src/gen/index.ts';
import { helloIr, ROOT } from '../helpers.ts';

const hasClang = spawnSync('clang++', ['--version']).status === 0;
let dir = '';
let binary = '';

const run = (...args: string[]) => spawnSync(binary, args, { encoding: 'utf8' });

describe('given the hello app linked with a stub UI', { skip: !hasClang && 'clang++ not installed' }, () => {
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'forge-gen-run-'));
    writeProjectFiles(generateProject(helloIr(), 'macos'), dir);
    binary = join(dir, 'hello');
    const build = spawnSync('clang++', [
      '-std=c++20', '-Wall', '-Wextra', '-Werror', '-I', dir, '-I', RUNTIME_DIR,
      join(RUNTIME_DIR, 'main.cpp'), join(dir, 'actions.cpp'), join(dir, 'cli_router.cpp'),
      join(ROOT, 'test/gen/fixtures/ui_stub.cpp'), '-o', binary,
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
  it('when run with --version, then stdout is the version from the IR', () => {
    const result = run('--version');
    assert.equal(result.stdout, '0.1.0\n');
    assert.equal(result.status, 0);
  });
  it('when run with --help, then the options are listed with their descriptions', () => {
    const result = run('--help');
    assert.match(result.stdout, /--greet {4}Print the greeting/);
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
