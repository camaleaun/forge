import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('../../../', import.meta.url).pathname;
const fixture = join(root, 'test/fixtures/glass-app');
const onMac = process.platform === 'darwin' && spawnSync('cmake', ['--version']).status === 0;

// Xcode's actool major version (it follows the Xcode version), or 0 when there is no actool.
function actoolMajor(): number {
  if (process.platform !== 'darwin') return 0;
  const result = spawnSync('xcrun', ['actool', '--version'], { encoding: 'utf8' });
  const match = /short-bundle-version<\/key>\s*<string>(\d+)/.exec(result.stdout ?? '');
  return result.status === 0 && match ? Number(match[1]) : 0;
}
const major = actoolMajor();
const hasActool26 = major >= 26;

function forgeBuildAndCompile(project: string): { app: string; cleanup: () => void } {
  const work = mkdtempSync(join(tmpdir(), 'forge-glass-build-'));
  const sources = join(work, 'src');
  const run = (command: string, args: string[]) => {
    const result = spawnSync(command, args, { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  };
  run(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', join(root, 'src/cli/forge.ts'), 'build', '--project', project, '--out', sources]);
  run('cmake', ['-S', sources, '-B', join(work, 'build'), '-G', 'Unix Makefiles']);
  run('cmake', ['--build', join(work, 'build')]);
  return { app: join(work, 'build/hello.app/Contents'), cleanup: () => rmSync(work, { recursive: true, force: true }) };
}

function plistValue(app: string, key: string): string | undefined {
  const result = spawnSync('plutil', ['-extract', key, 'raw', join(app, 'Info.plist')], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

describe('given an app with an icon/ folder and Xcode 26 actool', { skip: !onMac ? 'needs macOS and cmake' : !hasActool26 && `needs Xcode 26 actool (found ${major || 'none'})` }, () => {
  let built: ReturnType<typeof forgeBuildAndCompile>;
  before(() => { built = forgeBuildAndCompile(fixture); });
  after(() => built.cleanup());

  it('when built, then Resources holds Assets.car and the fallback AppIcon.icns', () => {
    assert.ok(existsSync(join(built.app, 'Resources/Assets.car')));
    assert.ok(existsSync(join(built.app, 'Resources/AppIcon.icns')));
  });
  it('when built, then Info.plist names CFBundleIconName and CFBundleIconFile', () => {
    assert.equal(plistValue(built.app, 'CFBundleIconName'), 'AppIcon');
    assert.equal(plistValue(built.app, 'CFBundleIconFile'), 'AppIcon');
  });
});

describe('given an app with an icon/ folder but no Xcode 26 actool', { skip: !onMac ? 'needs macOS and cmake' : hasActool26 && 'the real actool branch is tested above' }, () => {
  const copies: string[] = [];
  after(() => copies.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

  it('when icon.svg exists too, then the bundle gets the classic AppIcon.icns and no Assets.car', () => {
    const project = mkdtempSync(join(tmpdir(), 'forge-glass-fallback-'));
    copies.push(project);
    cpSync(fixture, project, { recursive: true });
    writeFileSync(join(project, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#09f"/></svg>');
    const built = forgeBuildAndCompile(project);
    try {
      assert.ok(existsSync(join(built.app, 'Resources/AppIcon.icns')));
      assert.ok(!existsSync(join(built.app, 'Resources/Assets.car')));
      assert.equal(plistValue(built.app, 'CFBundleIconFile'), 'AppIcon');
      assert.equal(plistValue(built.app, 'CFBundleIconName'), undefined);
    } finally {
      built.cleanup();
    }
  });

  it('when there is no icon.svg, then the bundle has no icon at all', () => {
    const built = forgeBuildAndCompile(fixture);
    try {
      assert.ok(!existsSync(join(built.app, 'Resources/Assets.car')));
      assert.ok(!existsSync(join(built.app, 'Resources/AppIcon.icns')));
      assert.equal(plistValue(built.app, 'CFBundleIconFile'), '', 'CMake writes an empty value when no icon is set');
    } finally {
      built.cleanup();
    }
  });
});
