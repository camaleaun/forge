// Runs a generated GTK steps app for real under a virtual display: the window content size follows the screen, the
// controls of the other screens are hidden, next and back stop at the ends, goTo jumps by id and quit ends the app.
// Needs Linux with g++, GTK 4 and xvfb-run; it runs on the Linux CI.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateProject, writeProjectFiles, RUNTIME_DIR } from '../../../src/gen/index.ts';
import { ROOT } from '../helpers.ts';
import { stepsIr } from './steps-irs.ts';

const has = (command: string, args: string[]): boolean => spawnSync(command, args).status === 0;
const gtk = spawnSync('pkg-config', ['--cflags', '--libs', 'gtk4'], { encoding: 'utf8' });
const canRun = process.platform === 'linux' && has('g++', ['--version']) && gtk.status === 0 && has('sh', ['-c', 'command -v xvfb-run']);
const dir = mkdtempSync(join(tmpdir(), 'forge-gen-steps-linux-'));
const binary = join(dir, 'app');
after(() => rmSync(dir, { recursive: true, force: true }));

before(() => {
  if (!canRun) return;
  writeProjectFiles(generateProject(stepsIr(), 'linux'), dir);
  const result = spawnSync('g++', [
    '-std=c++20', '-Wall', '-Wextra', '-Werror', '-Wno-unused-function', '-I', dir, '-I', RUNTIME_DIR,
    join(ROOT, 'test/gen/fixtures/ui_steps_driver.cpp'), join(dir, 'ui_linux.cpp'), join(dir, 'actions.cpp'), ...gtk.stdout.trim().split(/\s+/), '-o', binary,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

function lines(...clicks: string[]): string[] {
  const env = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', GDK_BACKEND: 'x11' };
  const run = has('dbus-run-session', ['--version']) ? ['dbus-run-session', '--', binary, ...clicks] : [binary, ...clicks];
  const result = spawnSync('xvfb-run', ['-a', '-s', '-screen 0 1280x800x24', ...run], { encoding: 'utf8', env, timeout: 60000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout.trim().split('\n').filter((line) => /^\d+x\d+ resizable=/.test(line));
}

describe('given a generated GTK app with two screens, running in a real window', { skip: !canRun && 'needs Linux with g++, GTK 4 and xvfb-run' }, () => {
  it('when it opens, then the window has the size of the first screen, is not resizable and shows only its controls', () => {
    assert.equal(lines()[0], '420x180 resizable=0 Next Back');
  });
  it('when Next is clicked, then the second screen shows with its own width and the root height (a missing side)', () => {
    assert.equal(lines('Next')[1], '600x200 resizable=0 Back Again Next Quit');
  });
  it('when Back is clicked from the second screen, then the first size returns', () => {
    assert.equal(lines('Next', 'Back')[2], '420x180 resizable=0 Next Back');
  });
  it('when Back is clicked on the first screen or Next on the last, then it stays (clamped at the ends)', () => {
    assert.deepEqual(lines('Back', 'Next', 'Next').slice(1), ['420x180 resizable=0 Next Back', '600x200 resizable=0 Back Again Next Quit', '600x200 resizable=0 Back Again Next Quit']);
  });
  it('when goTo names the first screen from the second, then it returns by id', () => {
    assert.equal(lines('Next', 'Again')[2], '420x180 resizable=0 Next Back');
  });
  it('when Quit is clicked, then the app ends by itself (no further report)', () => {
    assert.equal(lines('Next', 'Quit').length, 2);
  });
});
