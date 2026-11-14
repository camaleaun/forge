// Runs a generated macOS app for real and resizes its window: the @media variants must follow the window size,
// in both directions. Needs a macOS desktop session (a window server) and clang++.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateProject, writeProjectFiles, RUNTIME_DIR } from '../../../src/gen/index.ts';
import type { Ir } from '../../../src/ir/types.ts';
import { ROOT } from '../helpers.ts';
import { resizeIr, stretchIr } from './resize-irs.ts';

const canRun = process.platform === 'darwin' && spawnSync('clang++', ['--version']).status === 0;

function build(ir: Ir): { dir: string; binary: string } {
  const dir = mkdtempSync(join(tmpdir(), 'forge-gen-resize-'));
  writeProjectFiles(generateProject(ir, 'macos'), dir);
  const binary = join(dir, 'app');
  const result = spawnSync('clang++', [
    '-std=c++20', '-fobjc-arc', '-Wall', '-Wextra', '-Werror', '-Wno-deprecated-declarations', '-I', dir, '-I', RUNTIME_DIR,
    join(ROOT, 'test/gen/fixtures/ui_resize_driver.mm'), join(dir, 'ui_macos.mm'), join(dir, 'actions.cpp'),
    '-framework', 'Cocoa', '-o', binary,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return { dir, binary };
}

const dirs: string[] = [];
after(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function frames(binary: string, ...sizes: string[]): string[] {
  const result = spawnSync(binary, sizes, { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim().split('\n');
}

describe('given a generated macOS app with @media variants, running in a real window', { skip: !canRun && 'needs macOS with clang++' }, () => {
  let binary = '';
  before(() => {
    const built = build(resizeIr());
    dirs.push(built.dir);
    binary = built.binary;
  });

  it('when the window opens narrow, then the base layout applies (a column)', () => {
    assert.equal(frames(binary)[0], '320x200 10,10,60,20 10,38,60,20');
  });
  it('when the window is resized to 500x300, then the variants apply: a row with its own gap, padding and widths', () => {
    assert.equal(frames(binary, '500x300')[1], '500x300 30,30,60,20 110,30,120,20');
  });
  it('when the window is made narrow again, then the base layout returns', () => {
    assert.equal(frames(binary, '500x300', '320x200')[2], '320x200 10,10,60,20 10,38,60,20');
  });
});

describe('given a stretched column whose variants turn it into a row with a growing child', { skip: !canRun && 'needs macOS with clang++' }, () => {
  let binary = '';
  before(() => {
    const built = build(stretchIr());
    dirs.push(built.dir);
    binary = built.binary;
  });

  it('when the window opens narrow, then both children are stretched across the column', () => {
    assert.equal(frames(binary)[0], '320x200 10,10,300,20 10,38,300,20');
  });
  it('when the window is resized to 500x300, then the row has a fixed first child and a second one that fills the rest', () => {
    assert.equal(frames(binary, '500x300')[1], '500x300 20,20,80,20 108,20,372,20');
  });
  it('when the window is made narrow again, then the children are stretched across the column again', () => {
    assert.equal(frames(binary, '500x300', '320x200')[2], '320x200 10,10,300,20 10,38,300,20');
  });
});
