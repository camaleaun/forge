import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateProject, writeProjectFiles, RUNTIME_DIR, RUNTIME_FILES } from '../../../src/gen/index.ts';
import { helloIr } from '../helpers.ts';

const has = (command: string, args: string[]) => spawnSync(command, args).status === 0;
const canBuild = process.platform === 'linux' && has('cmake', ['--version']) && has('pkg-config', ['--exists', 'gtk4']);
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" rx="2" fill="#f60"/></svg>';
const META = { description: 'Says hello', license: 'MIT', homepage: 'https://example.org/hello' };
let dir = '';
let root = '';

describe('given a generated hello project with an icon, installed with cmake --install', { skip: !canBuild && 'needs Linux, cmake and gtk4' }, () => {
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'forge-gen-linux-install-'));
    root = join(dir, 'root');
    const ir = helloIr();
    ir.app.icon = 'AppIcon.icns';
    writeProjectFiles(generateProject(ir, 'linux', { iconSvg: SVG, meta: META }), dir);
    for (const file of RUNTIME_FILES) copyFileSync(join(RUNTIME_DIR, file), join(dir, file));
    const configure = spawnSync('cmake', ['-S', dir, '-B', join(dir, 'build'), '-DCMAKE_INSTALL_PREFIX=/usr'], { encoding: 'utf8' });
    assert.equal(configure.status, 0, configure.stdout + configure.stderr);
    const build = spawnSync('cmake', ['--build', join(dir, 'build')], { encoding: 'utf8' });
    assert.equal(build.status, 0, build.stdout + build.stderr);
    const install = spawnSync('cmake', ['--install', join(dir, 'build')], { encoding: 'utf8', env: { ...process.env, DESTDIR: root } });
    assert.equal(install.status, 0, install.stdout + install.stderr);
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('when installed, then exactly the expected files exist', () => {
    const files = (readdirSync(root, { recursive: true, withFileTypes: true }) as { name: string; parentPath: string; isFile(): boolean }[])
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name).slice(root.length))
      .sort();
    assert.deepEqual(files, [
      '/usr/bin/hello',
      '/usr/share/applications/local.forge.hello.desktop',
      ...[128, 16, 256, 32, 48, 512, 64].map((size) => `/usr/share/icons/hicolor/${size}x${size}/apps/local.forge.hello.png`),
      '/usr/share/icons/hicolor/scalable/apps/local.forge.hello.svg',
      '/usr/share/metainfo/local.forge.hello.metainfo.xml',
    ]);
  });
  it('when desktop-file-validate runs, then the .desktop has no complaints', { skip: !has('desktop-file-validate', ['--help']) && 'desktop-file-validate not installed' }, () => {
    const result = spawnSync('desktop-file-validate', [join(root, 'usr/share/applications/local.forge.hello.desktop')], { encoding: 'utf8' });
    assert.equal(result.stdout + result.stderr, '');
    assert.equal(result.status, 0);
  });
  it('when appstreamcli validates the metainfo, then there are no complaints', { skip: !has('appstreamcli', ['--version']) && 'appstreamcli not installed' }, () => {
    const result = spawnSync('appstreamcli', ['validate', '--no-net', join(root, 'usr/share/metainfo/local.forge.hello.metainfo.xml')], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });
});
