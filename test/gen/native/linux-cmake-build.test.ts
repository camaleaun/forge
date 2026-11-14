import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateProject, writeProjectFiles, RUNTIME_DIR, RUNTIME_FILES } from '../../../src/gen/index.ts';
import { helloIr } from '../helpers.ts';

const has = (command: string, args: string[]) => spawnSync(command, args).status === 0;
const canBuild = process.platform === 'linux' && has('cmake', ['--version']) && has('pkg-config', ['--exists', 'gtk4']);
const MAX_BINARY_BYTES = 100 * 1024;
let dir = '';
let binary = '';

describe('given a generated hello project on Linux', { skip: !canBuild && 'needs Linux, cmake and gtk4' }, () => {
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'forge-gen-linux-cmake-'));
    writeProjectFiles(generateProject(helloIr(), 'linux'), dir);
    for (const file of RUNTIME_FILES) copyFileSync(join(RUNTIME_DIR, file), join(dir, file));
    const configure = spawnSync('cmake', ['-S', dir, '-B', join(dir, 'build'), '-G', 'Unix Makefiles'], { encoding: 'utf8' });
    assert.equal(configure.status, 0, configure.stdout + configure.stderr);
    const build = spawnSync('cmake', ['--build', join(dir, 'build')], { encoding: 'utf8' });
    assert.equal(build.status, 0, build.stdout + build.stderr);
    binary = join(dir, 'build/hello');
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('when built with cmake, then the executable exists', () => {
    assert.ok(existsSync(binary), `${binary} is missing`);
  });
  it('when run with --greet, then it prints the greeting', () => {
    const result = spawnSync(binary, ['--greet'], { encoding: 'utf8' });
    assert.equal(result.stdout, 'Hello, world!\n');
    assert.equal(result.status, 0);
  });
  it('when run with --version, then it prints the version', () => {
    assert.equal(spawnSync(binary, ['--version'], { encoding: 'utf8' }).stdout, '0.1.0\n');
  });
  it('when run with an unknown option, then it exits with 2', () => {
    assert.equal(spawnSync(binary, ['--nope'], { encoding: 'utf8' }).status, 2);
  });
  it('when its size is measured, then it is under 100 KB', () => {
    const size = statSync(binary).size;
    console.log(`# hello Linux binary size: ${size} bytes`);
    assert.ok(size < MAX_BINARY_BYTES, `${size} bytes is not under ${MAX_BINARY_BYTES}`);
  });
  it('when its libraries are listed, then gtk-4 is linked and libsoup is not', () => {
    const ldd = spawnSync('ldd', [binary], { encoding: 'utf8' }).stdout;
    assert.match(ldd, /libgtk-4/);
    assert.doesNotMatch(ldd, /libsoup/);
  });
  it('when its sections are listed, then it carries no debug sections', () => {
    const sections = spawnSync('readelf', ['-S', binary], { encoding: 'utf8' }).stdout;
    assert.doesNotMatch(sections, /\.debug_/);
  });
});
