import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('../../', import.meta.url).pathname;

function forge(...args: string[]) {
  return spawnSync(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', join(root, 'src/cli/forge.ts'), ...args], { encoding: 'utf8' });
}

function withProject(files: Record<string, string>, run: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'forge-info-'));
  try {
    for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('given a project with a package.json', () => {
  const pkg = JSON.stringify({ name: 'hello', version: '0.1.0-rc.1', private: true });

  it('when running "forge info --field version", then stdout is only the version', () => {
    withProject({ 'package.json': pkg }, (dir) => {
      const result = forge('info', '--project', dir, '--field', 'version');
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, '0.1.0-rc.1\n');
    });
  });

  it('when running "forge info --field name", then stdout is only the name', () => {
    withProject({ 'package.json': pkg }, (dir) => {
      assert.equal(forge('info', '--project', dir, '--field', 'name').stdout, 'hello\n');
    });
  });

  it('when the field is unknown or missing, then the exit code is 2 and stderr shows the usage', () => {
    withProject({ 'package.json': pkg }, (dir) => {
      for (const args of [['--field', 'license'], []]) {
        const result = forge('info', '--project', dir, ...args);
        assert.equal(result.status, 2);
        assert.match(result.stderr, /forge info/);
      }
    });
  });
});

describe('given a directory without a usable package.json', () => {
  it('when running "forge info", then the exit code is 1 and stderr names package.json', () => {
    withProject({}, (dir) => {
      const result = forge('info', '--project', dir, '--field', 'version');
      assert.equal(result.status, 1);
      assert.match(result.stderr, /package\.json/);
    });
    withProject({ 'package.json': '{ "name": "x" }' }, (dir) => {
      const result = forge('info', '--project', dir, '--field', 'version');
      assert.equal(result.status, 1);
      assert.match(result.stderr, /package\.json: missing "version"/);
    });
  });
});
