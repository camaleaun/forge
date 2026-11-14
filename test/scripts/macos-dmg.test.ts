import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const script = new URL('../../scripts/macos-dmg.sh', import.meta.url).pathname;
const hasShellcheck = spawnSync('shellcheck', ['--version']).status === 0;

// Runs the script with fake `cpack` and `hdiutil` first in PATH; cpack fails `failures` times, then succeeds.
function run(args: string[], failures: number, env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'forge-dmg-'));
  const log = join(dir, 'calls.log');
  const counter = join(dir, 'counter');
  writeFileSync(join(dir, 'cpack'), `#!/bin/sh
echo "cpack $*" >> "${log}"
n=$(cat "${counter}" 2>/dev/null || echo 0); n=$((n + 1)); echo $n > "${counter}"
[ "$n" -gt ${failures} ]
`);
  writeFileSync(join(dir, 'hdiutil'), `#!/bin/sh\necho "hdiutil $*" >> "${log}"\n`);
  chmodSync(join(dir, 'cpack'), 0o755);
  chmodSync(join(dir, 'hdiutil'), 0o755);
  const result = spawnSync('bash', [script, ...args], {
    encoding: 'utf8',
    env: { PATH: `${dir}:${process.env.PATH}`, FORGE_DMG_RETRY_DELAY: '0', ...env },
  });
  const calls = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [];
  rmSync(dir, { recursive: true, force: true });
  return { ...result, calls };
}

const ARGS = ['build/out/CPackConfig.cmake', 'build/cpack', 'hello'];

describe('given cpack that works', () => {
  it('when running macos-dmg.sh, then cpack runs once for the DragNDrop generator and nothing is detached', () => {
    const { status, calls } = run(ARGS, 0);
    assert.equal(status, 0);
    assert.deepEqual(calls, ['cpack --config build/out/CPackConfig.cmake -G DragNDrop -B build/cpack']);
  });
});

describe('given cpack that fails because the Finder keeps the volume busy', () => {
  it('when it fails twice and then works, then the volume is force-detached between attempts and the exit code is 0', () => {
    const { status, calls, stderr } = run(ARGS, 2);
    assert.equal(status, 0);
    assert.deepEqual(calls.filter((c) => c.startsWith('cpack')).length, 3);
    assert.deepEqual(calls.filter((c) => c.startsWith('hdiutil')), ['hdiutil detach /Volumes/hello -force', 'hdiutil detach /Volumes/hello -force']);
    assert.match(stderr, /attempt 1 of 3/);
  });

  it('when it never works, then it gives up after the configured attempts with exit code 1', () => {
    const { status, calls, stderr } = run(ARGS, 99, { FORGE_DMG_ATTEMPTS: '2' });
    assert.equal(status, 1);
    assert.equal(calls.filter((c) => c.startsWith('cpack')).length, 2);
    assert.match(stderr, /cpack failed 2 times/);
  });
});

describe('given wrong usage or the script itself', () => {
  it('when an argument is missing, then the exit code is 2 and the usage is shown', () => {
    const { status, stderr } = run(['only-one'], 0);
    assert.equal(status, 2);
    assert.match(stderr, /Usage: macos-dmg\.sh/);
  });

  it('when linted with shellcheck, then it reports nothing', { skip: !hasShellcheck && 'shellcheck not installed' }, () => {
    const result = spawnSync('shellcheck', [script], { encoding: 'utf8' });
    assert.equal(result.stdout + result.stderr, '');
    assert.equal(result.status, 0);
  });
});
