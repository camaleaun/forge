import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateAppHeader } from '../../src/generate/app-header.ts';
import { generateActionsCpp } from '../../src/generate/actions-cpp.ts';
import { generateCliRouter } from '../../src/generate/cli-router.ts';
import { generateMacosUi } from '../../src/generate/macos.ts';
import { generateCmake } from '../../src/generate/cmake.ts';
import { hello } from '../helpers/fixtures.ts';

const canBuild = process.platform === 'darwin' && spawnSync('cmake', ['--version']).status === 0;
const root = new URL('../../', import.meta.url).pathname;
const effects = { greet: [{ op: 'setText' as const, target: 'message', text: 'Hello, world!' }] };
const MAX_BINARY_BYTES = 300 * 1024;
let dir = '';
let binary = '';

describe('given a generated hello project on macOS', { skip: !canBuild && 'needs macOS and cmake' }, () => {
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'forge-cmake-'));
    writeFileSync(join(dir, 'forge_app.hpp'), generateAppHeader(hello(), ['greet']));
    writeFileSync(join(dir, 'actions.cpp'), generateActionsCpp(effects));
    writeFileSync(join(dir, 'cli_router.cpp'), generateCliRouter(hello()));
    writeFileSync(join(dir, 'ui_macos.mm'), generateMacosUi(hello()));
    writeFileSync(join(dir, 'CMakeLists.txt'), generateCmake(hello()));
    for (const file of ['main.cpp', 'cli_surface.hpp']) copyFileSync(join(root, 'runtime', file), join(dir, file));

    const configure = spawnSync('cmake', ['-S', dir, '-B', join(dir, 'build'), '-G', 'Unix Makefiles'], { encoding: 'utf8' });
    assert.equal(configure.status, 0, configure.stdout + configure.stderr);
    const build = spawnSync('cmake', ['--build', join(dir, 'build')], { encoding: 'utf8' });
    assert.equal(build.status, 0, build.stdout + build.stderr);
    binary = join(dir, 'build/hello.app/Contents/MacOS/hello');
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('when built with cmake, then hello.app contains the executable', () => {
    assert.ok(existsSync(binary), `${binary} is missing`);
  });

  it('when the executable runs with --greet, then it prints the greeting', () => {
    const result = spawnSync(binary, ['--greet'], { encoding: 'utf8' });
    assert.equal(result.stdout, 'Hello, world!\n');
    assert.equal(result.status, 0);
  });

  it('when cpack runs, then a .dmg is produced and hdiutil accepts it', () => {
    const pack = spawnSync('cpack', ['--config', join(dir, 'build/CPackConfig.cmake'), '-B', join(dir, 'dist')], { encoding: 'utf8', cwd: join(dir, 'build') });
    assert.equal(pack.status, 0, pack.stdout + pack.stderr);
    const found = readdirSync(join(dir, 'dist')).filter((file) => file.endsWith('.dmg'));
    assert.equal(found.length, 1, `expected one .dmg in dist, found: ${readdirSync(join(dir, 'dist')).join(', ')}`);
    const dmg = join(dir, 'dist', found[0]);
    console.log(`# hello dmg name: ${found[0]}`);
    const info = spawnSync('hdiutil', ['imageinfo', dmg], { encoding: 'utf8' });
    assert.equal(info.status, 0, info.stderr);
    console.log(`# hello dmg size: ${statSync(dmg).size} bytes`);
  });

  it('when its size is measured, then it is under 300 KB', () => {
    const size = statSync(binary).size;
    console.log(`# hello binary size: ${size} bytes`);
    assert.ok(size < MAX_BINARY_BYTES, `${size} bytes is not under ${MAX_BINARY_BYTES}`);
  });
});

describe('given a generated project with a prerelease version', { skip: !canBuild && 'needs macOS and cmake' }, () => {
  it('when cmake configures it, then it succeeds (project(VERSION) takes only the numeric part)', () => {
    const spec = hello();
    spec.app.version = '0.1.0-rc.1';
    const project = mkdtempSync(join(tmpdir(), 'forge-rc-'));
    try {
      writeFileSync(join(project, 'CMakeLists.txt'), generateCmake(spec));
      for (const file of ['main.cpp', 'actions.cpp', 'cli_router.cpp', 'ui_macos.mm', 'cli_surface.hpp', 'forge_app.hpp']) writeFileSync(join(project, file), '');
      const configure = spawnSync('cmake', ['-S', project, '-B', join(project, 'build'), '-G', 'Unix Makefiles'], { encoding: 'utf8' });
      assert.equal(configure.status, 0, configure.stdout + configure.stderr);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
