import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('../../', import.meta.url).pathname;
const fixture = join(root, 'test/fixtures/hello');
let out = '';

function forge(...args: string[]) {
  return spawnSync(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', join(root, 'src/cli/forge.ts'), ...args], { encoding: 'utf8' });
}

describe('given a project directory with forge.json and actions.ts', () => {
  before(() => { out = mkdtempSync(join(tmpdir(), 'forge-build-')); });
  after(() => rmSync(out, { recursive: true, force: true }));

  it('when running "forge build --target macos", then the output holds every generated and runtime file and the exit code is 0', () => {
    const result = forge('build', '--project', fixture, '--target', 'macos', '--out', out);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readdirSync(out).sort(), [
      'CMakeLists.txt', 'actions.cpp', 'cli_router.cpp', 'cli_surface.hpp', 'forge_app.hpp', 'main.cpp', 'ui_macos.mm',
    ]);
  });

  it('when running forge build twice on the same project, then the outputs are byte-identical', () => {
    const second = mkdtempSync(join(tmpdir(), 'forge-build-'));
    try {
      assert.equal(forge('build', '--project', fixture, '--out', second).status, 0);
      for (const name of readdirSync(out)) assert.equal(readFileSync(join(second, name), 'utf8'), readFileSync(join(out, name), 'utf8'), name);
    } finally {
      rmSync(second, { recursive: true, force: true });
    }
  });

  it('when run with no subcommand or without --out, then usage goes to stderr and the exit code is 2', () => {
    for (const args of [[], ['build']]) {
      const result = forge(...args);
      assert.equal(result.status, 2);
      assert.match(result.stderr, /Usage: forge build/);
    }
  });
});

describe('given a project whose forge.json has several mistakes', () => {
  it('when running forge build, then every validation error is listed on stderr and the exit code is 1', () => {
    const project = mkdtempSync(join(tmpdir(), 'forge-bad-'));
    const target = mkdtempSync(join(tmpdir(), 'forge-bad-out-'));
    try {
      cpSync(fixture, project, { recursive: true });
      const spec = JSON.parse(readFileSync(join(project, 'forge.json'), 'utf8'));
      spec.app.version = '1.0';
      spec.widgets[1].action = 'missing';
      writeFileSync(join(project, 'forge.json'), JSON.stringify(spec));
      const result = forge('build', '--project', project, '--out', target);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /app\.version: "1\.0" must be semver/);
      assert.match(result.stderr, /widgets\[1\]\.action: unknown action "missing"/);
      assert.deepEqual(readdirSync(target), []);
    } finally {
      rmSync(project, { recursive: true, force: true });
      rmSync(target, { recursive: true, force: true });
    }
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
