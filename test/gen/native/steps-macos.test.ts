// Runs a generated macOS steps app for real: the window content size follows the screen, the controls of the other
// screens are hidden, next and back stop at the ends, goTo jumps by id and quit ends the app.
// Needs a macOS desktop session (a window server) and clang++.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Ir } from '../../../src/ir/types.ts';
import { spawnSync } from 'node:child_process';
import { generateProject, writeProjectFiles, RUNTIME_DIR } from '../../../src/gen/index.ts';
import { ROOT } from '../helpers.ts';
import { footerIr, stepsIr } from './steps-irs.ts';

const canRun = process.platform === 'darwin' && spawnSync('clang++', ['--version']).status === 0;
const dir = mkdtempSync(join(tmpdir(), 'forge-gen-steps-'));
const binary = join(dir, 'app');
after(() => rmSync(dir, { recursive: true, force: true }));

const footerBinary = join(dir, 'footer');

function compile(ir: Ir, out: string): void {
  const sub = mkdtempSync(join(dir, 'p-'));
  writeProjectFiles(generateProject(ir, 'macos'), sub);
  const result = spawnSync('clang++', [
    '-std=c++20', '-fobjc-arc', '-Wall', '-Wextra', '-Werror', '-Wno-deprecated-declarations', '-I', sub, '-I', RUNTIME_DIR,
    join(ROOT, 'test/gen/fixtures/ui_steps_driver.mm'), join(sub, 'ui_macos.mm'), join(sub, 'actions.cpp'), '-framework', 'Cocoa', '-o', out,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

before(() => {
  if (!canRun) return;
  compile(stepsIr(), binary);
  compile(footerIr(), footerBinary);
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
  it('when Enter is pressed, then the primary button of the visible screen fires; Escape fires the cancel button (and both stop at the ends)', () => {
    assert.deepEqual(lines('key:Enter', 'key:Enter', 'key:Escape', 'key:Escape').map((line) => line.slice(0, 7)), ['420x180', '600x200', '600x200', '420x180', '420x180']);
  });
  it('when Quit is clicked, then the app ends by itself (no further report)', () => {
    assert.equal(lines('Next', 'Quit').length, 2);
  });
});

// The geometry lines of the footer app: the rectangles (x,y,w,h from the top left) sorted by name.
function geometry(...resizes: string[]): string[] {
  const result = spawnSync(footerBinary, resizes, { encoding: 'utf8', timeout: 30000, env: { ...process.env, FORGE_GEOMETRY: '1' } });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.split('\n').filter((line) => line.startsWith('geometry')).map((line) => line.split(' ').slice(1).sort().join(' '));
}

describe('given a screen made of plain views (a growing content, a 1 px divider and a footer row), in a real window', { skip: !canRun && 'needs macOS with clang++' }, () => {
  it('when the window opens, then the footer buttons sit 14 px from the right and bottom edges, 12 px apart, under a 1 px full-width line', () => {
    assert.equal(geometry()[0], 'Back=404,402,85,24 Close=501,402,85,24 line=0,387,600,1');
  });
  it('when the window grows to 700x500, then the footer and the line stay pinned to the bottom right', () => {
    assert.equal(geometry('700x500')[1], 'Back=504,462,85,24 Close=601,462,85,24 line=0,447,700,1');
  });
});
