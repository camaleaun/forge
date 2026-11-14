import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateProject, writeProjectFiles, RUNTIME_DIR, RUNTIME_FILES } from '../../../src/gen/index.ts';
import { helloIr } from '../helpers.ts';

const canBuild = process.platform === 'darwin' && spawnSync('cmake', ['--version']).status === 0;
const MAX_BINARY_BYTES = 300 * 1024;
let dir = '';
let binary = '';

describe('given a generated hello project on macOS', { skip: !canBuild && 'needs macOS and cmake' }, () => {
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'forge-gen-cmake-'));
    writeProjectFiles(generateProject(helloIr(), 'macos'), dir);
    for (const file of RUNTIME_FILES) copyFileSync(join(RUNTIME_DIR, file), join(dir, file));

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
  it('when its size is measured, then it is under 300 KB', () => {
    const size = statSync(binary).size;
    console.log(`# hello binary size (NSStackView layout): ${size} bytes`);
    assert.ok(size < MAX_BINARY_BYTES, `${size} bytes is not under ${MAX_BINARY_BYTES}`);
  });
});

describe('given a generated project with an app icon', { skip: !canBuild && 'needs macOS and cmake' }, () => {
  it('when built with cmake, then the bundle has Resources/AppIcon.icns and Info.plist names the icon', () => {
    const iconDir = mkdtempSync(join(tmpdir(), 'forge-gen-icon-'));
    try {
      const ir = helloIr();
      ir.app.icon = 'AppIcon.icns';
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8" rx="2" fill="#09f"/></svg>';
      writeProjectFiles(generateProject(ir, 'macos', { iconSvg: svg }), iconDir);
      for (const file of RUNTIME_FILES) copyFileSync(join(RUNTIME_DIR, file), join(iconDir, file));
      const configure = spawnSync('cmake', ['-S', iconDir, '-B', join(iconDir, 'build'), '-G', 'Unix Makefiles'], { encoding: 'utf8' });
      assert.equal(configure.status, 0, configure.stdout + configure.stderr);
      const build = spawnSync('cmake', ['--build', join(iconDir, 'build')], { encoding: 'utf8' });
      assert.equal(build.status, 0, build.stdout + build.stderr);
      const app = join(iconDir, 'build/hello.app/Contents');
      assert.ok(existsSync(join(app, 'Resources/AppIcon.icns')), 'AppIcon.icns is in Resources');
      const plist = spawnSync('plutil', ['-extract', 'CFBundleIconFile', 'raw', join(app, 'Info.plist')], { encoding: 'utf8' });
      assert.equal(plist.stdout.trim(), 'AppIcon');
      const iconset = spawnSync('iconutil', ['--convert', 'iconset', join(app, 'Resources/AppIcon.icns'), '-o', join(iconDir, 'out.iconset')], { encoding: 'utf8' });
      assert.equal(iconset.status, 0, iconset.stderr);
    } finally {
      rmSync(iconDir, { recursive: true, force: true });
    }
  });
});
