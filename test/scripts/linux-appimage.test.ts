import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const script = new URL('../../scripts/linux-appimage.sh', import.meta.url).pathname;
const source = readFileSync(script, 'utf8');
const hasShellcheck = spawnSync('shellcheck', ['--version']).status === 0;
const RUNTIME = Buffer.from('fake-runtime-bytes\n');
const sha = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

// An installed tree (what `cmake --install` with DESTDIR makes) plus a fake mksquashfs that copies the AppDir aside.
function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'forge-appimage-'));
  const root = join(dir, 'root');
  for (const path of ['usr/bin', 'usr/share/applications', 'usr/share/icons/hicolor/256x256/apps', 'usr/share/icons/hicolor/512x512/apps']) mkdirSync(join(root, path), { recursive: true });
  writeFileSync(join(root, 'usr/bin/hello'), '#!/bin/sh\necho hi\n');
  chmodSync(join(root, 'usr/bin/hello'), 0o755);
  writeFileSync(join(root, 'usr/share/applications/local.forge.hello.desktop'), '[Desktop Entry]\nExec=hello\n');
  writeFileSync(join(root, 'usr/share/icons/hicolor/256x256/apps/local.forge.hello.png'), 'png256');
  writeFileSync(join(root, 'usr/share/icons/hicolor/512x512/apps/local.forge.hello.png'), 'png512');
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'mksquashfs'), `#!/bin/sh
echo "mksquashfs $*" >> "${dir}/calls.log"
cp -R "$1" "${dir}/appdir-copy"
echo squashfs-image > "$2"
`);
  chmodSync(join(bin, 'mksquashfs'), 0o755);
  writeFileSync(join(bin, 'curl'), `#!/bin/sh
echo "curl $*" >> "${dir}/calls.log"
exit 1
`);
  chmodSync(join(bin, 'curl'), 0o755);
  const runtime = join(dir, 'runtime-file');
  writeFileSync(runtime, RUNTIME);
  return { dir, root, bin, runtime, out: join(dir, 'hello.AppImage') };
}

function run(args: string[], env: Record<string, string>, bin: string) {
  return spawnSync('bash', [script, ...args], { encoding: 'utf8', env: { PATH: `${bin}:${process.env.PATH}`, ...env } });
}

describe('given the pinned runtime', () => {
  it('when the script is read, then it pins the type2-runtime release 20251108 by sha256 for both architectures', () => {
    assert.match(source, /^RUNTIME_RELEASE=20251108$/m);
    assert.match(source, /releases\/download\/\$RUNTIME_RELEASE\/runtime-/);
    assert.ok(!source.includes('download/continuous'));
    assert.ok(source.includes('2fca8b443c92510f1483a883f60061ad09b46b978b2631c807cd873a47ec260d'));
    assert.ok(source.includes('00cbdfcf917cc6c0ff6d3347d59e0ca1f7f45a6df1a428a0d6d8a78664d87444'));
  });
});

describe('given an installed tree and a runtime whose sha256 matches', () => {
  it('when running linux-appimage.sh, then the AppDir has AppRun, the .desktop and the icon, and the output is runtime + squashfs', () => {
    const { dir, root, bin, runtime, out } = setup();
    try {
      const result = run([root, 'hello', 'local.forge.hello', 'x86_64', out], { FORGE_APPIMAGE_RUNTIME_FILE: runtime, FORGE_APPIMAGE_RUNTIME_SHA256: sha(RUNTIME) }, bin);
      assert.equal(result.status, 0, result.stderr);
      const appdir = join(dir, 'appdir-copy');
      const appRun = readFileSync(join(appdir, 'AppRun'), 'utf8');
      assert.match(appRun, /exec "\$HERE\/usr\/bin\/hello" "\$@"/);
      assert.ok(statSync(join(appdir, 'AppRun')).mode & 0o111, 'AppRun is executable');
      assert.ok(existsSync(join(appdir, 'local.forge.hello.desktop')));
      assert.equal(readFileSync(join(appdir, 'local.forge.hello.png'), 'utf8'), 'png512');
      assert.equal(readFileSync(join(appdir, '.DirIcon'), 'utf8'), 'png512');
      assert.ok(existsSync(join(appdir, 'usr/bin/hello')));
      assert.equal(readFileSync(out, 'utf8'), 'fake-runtime-bytes\nsquashfs-image\n');
      assert.ok(statSync(out).mode & 0o111, 'the AppImage is executable');
      assert.match(readFileSync(join(dir, 'calls.log'), 'utf8'), /mksquashfs .* -root-owned -noappend/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('given a runtime whose sha256 does not match the pin', () => {
  it('when running linux-appimage.sh, then it aborts with exit 1 and writes no AppImage', () => {
    const { dir, root, bin, runtime, out } = setup();
    try {
      const result = run([root, 'hello', 'local.forge.hello', 'x86_64', out], { FORGE_APPIMAGE_RUNTIME_FILE: runtime }, bin);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /sha256/);
      assert.ok(!existsSync(out));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it('when the download itself fails, then it aborts with exit 1', () => {
    const { dir, root, bin, out } = setup();
    try {
      const result = run([root, 'hello', 'local.forge.hello', 'arm64', out], {}, bin);
      assert.equal(result.status, 1);
      assert.match(readFileSync(join(dir, 'calls.log'), 'utf8'), /releases\/download\/20251108\/runtime-aarch64/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('given bad arguments', () => {
  it('when the architecture is unknown, then the exit code is 2', () => {
    const { dir, root, bin, out } = setup();
    try {
      assert.equal(run([root, 'hello', 'local.forge.hello', 'riscv', out], {}, bin).status, 2);
      assert.equal(run([], {}, bin).status, 2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('given the script itself', { skip: !hasShellcheck && 'shellcheck not installed' }, () => {
  it('when linted with shellcheck, then it has no findings', () => {
    assert.equal(spawnSync('shellcheck', [script], { encoding: 'utf8' }).status, 0);
  });
});
