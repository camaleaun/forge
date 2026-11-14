import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const workflow = '.github/workflows/ci.yml';
const hasActionlint = spawnSync('actionlint', ['--version']).status === 0;

describe('given the repository CI workflow', () => {
  it('when looked up, then ci.yml exists', () => {
    assert.ok(existsSync(workflow), `${workflow} is missing`);
  });

  it('when linted with actionlint, then it reports nothing', { skip: !hasActionlint && 'actionlint not installed' }, () => {
    const result = spawnSync('actionlint', [workflow], { encoding: 'utf8' });
    assert.equal(result.stdout + result.stderr, '');
    assert.equal(result.status, 0);
  });

  it('when the Linux job is read, then it runs on both x86_64 and arm64 runners with the GTK 4 and libsoup 3 headers', () => {
    const text = readFileSync(workflow, 'utf8');
    assert.match(text, /linux-native:/);
    assert.match(text, /ubuntu-24\.04\b/);
    assert.match(text, /ubuntu-24\.04-arm/);
    assert.match(text, /libgtk-4-dev/);
    assert.match(text, /libsoup-3\.0-dev/);
  });

  it('when the Linux job runs the tests, then the AppImage is really executed (network tests on)', () => {
    const text = readFileSync(workflow, 'utf8');
    assert.match(text, /FORGE_NETWORK_TESTS: '1'/);
  });

  it('when the Linux job builds the sample app, then it checks the CLI and runs the window under a virtual display and keeps screenshots', () => {
    const text = readFileSync(workflow, 'utf8');
    assert.match(text, /forge build --target linux/);
    assert.match(text, /xvfb-run/);
    assert.match(text, /dbus-run-session/);
    assert.match(text, /upload-artifact/);
  });
});
