// Runs a generated macOS steps app for real: the window content size follows the screen, the controls of the other
// screens are hidden, next and back stop at the ends, goTo jumps by id and quit ends the app.
// Needs a macOS desktop session (a window server) and clang++.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateProject, writeProjectFiles, RUNTIME_DIR } from '../../../src/gen/index.ts';
import { ROOT } from '../helpers.ts';
import { stepsIr } from './steps-irs.ts';

const canRun = process.platform === 'darwin' && spawnSync('clang++', ['--version']).status === 0;
const dir = mkdtempSync(join(tmpdir(), 'forge-gen-steps-'));
const binary = join(dir, 'app');
after(() => rmSync(dir, { recursive: true, force: true }));

before(() => {
  if (!canRun) return;
  writeProjectFiles(generateProject(stepsIr(), 'macos'), dir);
  const result = spawnSync('clang++', [
    '-std=c++20', '-fobjc-arc', '-Wall', '-Wextra', '-Werror', '-Wno-deprecated-declarations', '-I', dir, '-I', RUNTIME_DIR,
    join(ROOT, 'test/gen/fixtures/ui_steps_driver.mm'), join(dir, 'ui_macos.mm'), join(dir, 'actions.cpp'), '-framework', 'Cocoa', '-o', binary,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

function lines(...clicks: string[]): string[] {
  const result = spawnSync(binary, clicks, { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim().split('\n');
}

describe('given a generated macOS app with two screens, running in a real window', { skip: !canRun && 'needs macOS with clang++' }, () => {
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
