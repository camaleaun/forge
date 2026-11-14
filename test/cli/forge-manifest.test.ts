import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('../../', import.meta.url).pathname;
const ABC_SHA256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

function forge(...args: string[]) {
  return spawnSync(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', join(root, 'src/cli/forge.ts'), ...args], { encoding: 'utf8' });
}

describe('given a dist directory with a portable zip and a dmg', () => {
  it('when running forge manifest, then stdout is the latest.json with the real sha256 and size', () => {
    const dist = mkdtempSync(join(tmpdir(), 'forge-dist-'));
    try {
      writeFileSync(join(dist, 'hello-0.1.0-darwin-arm64.zip'), 'abc');
      writeFileSync(join(dist, 'hello-0.1.0-Darwin.dmg'), 'ignored');
      const result = forge('manifest', '--dir', dist, '--tag', 'v0.1.0', '--repo', 'camaleaun/forge-hello-world');
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout), {
        version: '0.1.0',
        platforms: {
          'darwin-arm64': {
            url: 'https://github.com/camaleaun/forge-hello-world/releases/download/v0.1.0/hello-0.1.0-darwin-arm64.zip',
            sha256: ABC_SHA256,
            size: 3,
          },
        },
      });
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }
  });

  it('when the tag does not match the zip version, then the exit code is 1 and stderr names the file', () => {
    const dist = mkdtempSync(join(tmpdir(), 'forge-dist-'));
    try {
      writeFileSync(join(dist, 'hello-0.1.0-darwin-arm64.zip'), 'abc');
      const result = forge('manifest', '--dir', dist, '--tag', 'v0.2.0', '--repo', 'camaleaun/x');
      assert.equal(result.status, 1);
      assert.match(result.stderr, /hello-0\.1\.0-darwin-arm64\.zip/);
    } finally {
      rmSync(dist, { recursive: true, force: true });
    }
  });
});
