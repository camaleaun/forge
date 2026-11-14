import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('../../', import.meta.url).pathname;
const fixture = join(root, 'test/fixtures/hello-app');
const GENERATED_FILES = [
  'CMakeLists.txt', 'actions.cpp', 'cli_router.cpp', 'cli_surface.hpp', 'dmg', 'forge_app.hpp', 'main.cpp', 'ui_macos.mm',
];
let out = '';

function forge(...args: string[]) {
  return spawnSync(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', join(root, 'src/cli/forge.ts'), ...args], { encoding: 'utf8' });
}

function withProjectCopy(change: (dir: string) => void, run: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'forge-bad-'));
  try {
    cpSync(fixture, dir, { recursive: true });
    change(dir);
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('given an app with package.json, App.tsx and App.css', () => {
  before(() => { out = mkdtempSync(join(tmpdir(), 'forge-build-')); });
  after(() => rmSync(out, { recursive: true, force: true }));

  it('when running "forge build --target macos", then the output holds every generated and runtime file and the exit code is 0', () => {
    const result = forge('build', '--project', fixture, '--target', 'macos', '--out', out);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readdirSync(out).sort(), GENERATED_FILES);
  });

  it('when the app is built, then the generated sources carry the app data (version, state text, command)', () => {
    assert.ok(readFileSync(join(out, 'forge_app.hpp'), 'utf8').includes('APP_VERSION = "0.1.0"'));
    assert.ok(readFileSync(join(out, 'ui_macos.mm'), 'utf8').includes('Press the button'));
    assert.ok(readFileSync(join(out, 'cli_router.cpp'), 'utf8').includes('"--greet"'));
  });

  it('when running forge build twice on the same project, then the outputs are byte-identical', () => {
    const second = mkdtempSync(join(tmpdir(), 'forge-build-'));
    try {
      assert.equal(forge('build', '--project', fixture, '--out', second).status, 0);
      for (const name of readdirSync(out, { recursive: true })) {
        if (statSync(join(out, String(name))).isDirectory()) continue;
        assert.deepEqual(readFileSync(join(second, String(name))), readFileSync(join(out, String(name))), String(name));
      }
    } finally {
      rmSync(second, { recursive: true, force: true });
    }
  });

  it('when run with no subcommand or without --out, then usage goes to stderr and the exit code is 2', () => {
    for (const args of [[], ['build']]) {
      const result = forge(...args);
      assert.equal(result.status, 2);
      assert.match(result.stderr, /Usage:\n\s+forge build/);
    }
  });

  it('when the target is not supported, then the exit code is 1 and stderr names the target', () => {
    const result = forge('build', '--project', fixture, '--target', 'beos', '--out', out);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /unsupported target "beos" \(supported: macos\)/);
  });
});

describe('given an app with several mistakes', () => {
  it('when running forge build, then every error is listed on stderr with its position, the exit code is 1 and nothing is written', () => {
    const target = mkdtempSync(join(tmpdir(), 'forge-bad-out-'));
    withProjectCopy((dir) => {
      writeFileSync(join(dir, 'App.css'), 'window { margin-top: 4px; }\n');
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      pkg.version = '1.0';
      writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg));
    }, (dir) => {
      const result = forge('build', '--project', dir, '--out', target);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /error: package\.json: version "1\.0" must be semver/);
      assert.match(result.stderr, /error: App\.css:1:10: unknown property "margin-top"/);
      assert.deepEqual(readdirSync(target), []);
    });
    rmSync(target, { recursive: true, force: true });
  });
});

describe('given the bin/forge shim', () => {
  it('when invoked through a symlink elsewhere on disk, then it still finds the forge sources and builds', () => {
    const bin = mkdtempSync(join(tmpdir(), 'forge-bin-'));
    const target = mkdtempSync(join(tmpdir(), 'forge-bin-out-'));
    try {
      symlinkSync(join(root, 'bin/forge'), join(bin, 'forge'));
      const result = spawnSync(join(bin, 'forge'), ['build', '--project', fixture, '--out', target], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      assert.ok(readdirSync(target).includes('ui_macos.mm'));
    } finally {
      rmSync(bin, { recursive: true, force: true });
      rmSync(target, { recursive: true, force: true });
    }
  });
});
