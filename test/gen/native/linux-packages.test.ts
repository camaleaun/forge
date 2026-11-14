import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateProject, writeProjectFiles, RUNTIME_DIR, RUNTIME_FILES } from '../../../src/gen/index.ts';
import { linuxArch } from '../../../src/gen/linux-version.ts';
import { helloIr } from '../helpers.ts';

const has = (command: string, args: string[]) => spawnSync(command, args).status === 0;
const canBuild = process.platform === 'linux' && has('cmake', ['--version']) && has('pkg-config', ['--exists', 'gtk4']);
const arch = linuxArch(spawnSync('uname', ['-m'], { encoding: 'utf8' }).stdout.trim());
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" rx="2" fill="#f60"/></svg>';
let dir = '';
let out = '';

describe('given a hello 0.2.0-rc.1 project packaged with cpack', { skip: !canBuild && 'needs Linux, cmake and gtk4' }, () => {
  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'forge-gen-linux-pkg-'));
    out = join(dir, 'build');
    const ir = helloIr();
    ir.app.version = '0.2.0-rc.1';
    ir.app.icon = 'AppIcon.icns';
    writeProjectFiles(generateProject(ir, 'linux', { iconSvg: SVG, meta: { description: 'Says hello', license: 'MIT' } }), dir);
    for (const file of RUNTIME_FILES) copyFileSync(join(RUNTIME_DIR, file), join(dir, file));
    for (const args of [['-S', dir, '-B', out], ['--build', out]]) {
      const result = spawnSync('cmake', args, { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stdout + result.stderr);
    }
    const cpack = spawnSync('cpack', [], { cwd: out, encoding: 'utf8' });
    assert.equal(cpack.status, 0, cpack.stdout + cpack.stderr);
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('when cpack runs, then deb, rpm and tar.gz have the <app>-<version>-linux-<arch> names', () => {
    const files = readdirSync(out).filter((name) => /^hello-.*\.(deb|rpm|tar\.gz)$/.test(name)).sort();
    assert.deepEqual(files, ['deb', 'rpm', 'tar.gz'].map((ext) => `hello-0.2.0-rc.1-linux-${arch}.${ext}`));
  });
  it('when the deb is inspected, then it needs GTK 4 and its version has a tilde', { skip: !has('dpkg-deb', ['--version']) && 'dpkg-deb not installed' }, () => {
    const deb = join(out, `hello-0.2.0-rc.1-linux-${arch}.deb`);
    const field = (name: string) => spawnSync('dpkg-deb', ['-f', deb, name], { encoding: 'utf8' }).stdout.trim();
    assert.match(field('Depends'), /libgtk-4-1/);
    assert.equal(field('Version'), '0.2.0~rc.1');
    const contents = spawnSync('dpkg-deb', ['-c', deb], { encoding: 'utf8' }).stdout;
    assert.match(contents, /\.\/usr\/bin\/hello/);
    assert.match(contents, /usr\/share\/applications\/local\.forge\.hello\.desktop/);
  });
  it('when the rpm is inspected, then it requires gtk4 and has the binary', { skip: !has('rpm', ['--version']) && 'rpm not installed' }, () => {
    const rpm = join(out, `hello-0.2.0-rc.1-linux-${arch}.rpm`);
    const requires = spawnSync('rpm', ['-qp', '--requires', rpm], { encoding: 'utf8' }).stdout;
    assert.match(requires, /^gtk4$/m);
    assert.match(spawnSync('rpm', ['-qpl', rpm], { encoding: 'utf8' }).stdout, /\/usr\/bin\/hello/);
  });
  it('when the tar.gz is listed, then it holds the executable', () => {
    const list = spawnSync('tar', ['-tzf', join(out, `hello-0.2.0-rc.1-linux-${arch}.tar.gz`)], { encoding: 'utf8' }).stdout;
    assert.match(list, /usr\/bin\/hello$/m);
  });
});

const canAppImage = canBuild && has('mksquashfs', ['-version']) && process.env.FORGE_NETWORK_TESTS === '1';

describe('given a hello project packed as an AppImage', { skip: !canAppImage && 'needs Linux, cmake, gtk4, mksquashfs and FORGE_NETWORK_TESTS=1 (downloads the runtime)' }, () => {
  it('when run with --appimage-extract-and-run --greet, then it prints the greeting', () => {
    const work = mkdtempSync(join(tmpdir(), 'forge-gen-linux-appimage-'));
    try {
      writeProjectFiles(generateProject(helloIr(), 'linux'), work);
      for (const file of RUNTIME_FILES) copyFileSync(join(RUNTIME_DIR, file), join(work, file));
      for (const args of [['-S', work, '-B', join(work, 'build')], ['--build', join(work, 'build')]]) {
        assert.equal(spawnSync('cmake', args, { encoding: 'utf8' }).status, 0);
      }
      const root = join(work, 'root');
      assert.equal(spawnSync('cmake', ['--install', join(work, 'build')], { env: { ...process.env, DESTDIR: root } }).status, 0);
      const script = new URL('../../../scripts/linux-appimage.sh', import.meta.url).pathname;
      const image = join(work, 'hello.AppImage');
      const pack = spawnSync('bash', [script, root, 'hello', 'local.forge.hello', arch, image], { encoding: 'utf8' });
      assert.equal(pack.status, 0, pack.stderr);
      const result = spawnSync(image, ['--appimage-extract-and-run', '--greet'], { encoding: 'utf8' });
      assert.equal(result.stdout, 'Hello, world!\n');
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
});
