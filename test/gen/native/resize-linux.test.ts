// Runs a generated GTK app for real under a virtual display and resizes its window: the @media variants must
// follow the window size, in both directions, whether GTK or an outside tool (xdotool, like a user) resizes it.
// Needs Linux with g++, GTK 4 and xvfb-run; it runs on the Linux CI.
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

const has = (command: string, args: string[]): boolean => spawnSync(command, args).status === 0;
const gtk = spawnSync('pkg-config', ['--cflags', '--libs', 'gtk4'], { encoding: 'utf8' });
const canRun = process.platform === 'linux' && has('g++', ['--version']) && gtk.status === 0 && has('xvfb-run', ['--help']);
const SKIP = 'needs Linux with g++, GTK 4 (pkg-config gtk4) and xvfb-run';
const canXdotool = has('xdotool', ['version']);

function build(ir: Ir): { dir: string; binary: string } {
  const dir = mkdtempSync(join(tmpdir(), 'forge-gen-resize-linux-'));
  writeProjectFiles(generateProject(ir, 'linux'), dir);
  const binary = join(dir, 'app');
  const result = spawnSync('g++', [
    '-std=c++20', '-Wall', '-Wextra', '-Werror', '-I', dir, '-I', RUNTIME_DIR,
    join(ROOT, 'test/gen/fixtures/ui_resize_driver.cpp'), join(dir, 'ui_linux.cpp'), join(dir, 'actions.cpp'),
    ...gtk.stdout.trim().split(/\s+/), '-o', binary,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return { dir, binary };
}

const dirs: string[] = [];
after(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function frames(binary: string, resizeWith: 'gtk' | 'xdotool', ...sizes: string[]): string[] {
  const env = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', GDK_BACKEND: 'x11', FORGE_RESIZE_WITH: resizeWith };
  const run = has('dbus-run-session', ['--version']) ? ['dbus-run-session', '--', binary, ...sizes] : [binary, ...sizes];
  const result = spawnSync('xvfb-run', ['-a', '-s', '-screen 0 1280x800x24', ...run], { encoding: 'utf8', env, timeout: 60000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout.trim().split('\n').filter((line) => /^\d+x\d+/.test(line));
}

const RESIZE = '500x300';
const BACK = '320x200';
const COLUMN = '10,10,60,20 10,38,60,20';
const ROW = '30,30,60,20 110,30,120,20';
const STRETCH_COLUMN = '10,10,300,20 10,38,300,20';
const STRETCH_ROW = '20,20,80,20 108,20,372,20';

for (const resizeWith of ['gtk', 'xdotool'] as const) {
  const how = resizeWith === 'gtk' ? 'by GTK (default size)' : 'from outside with xdotool';
  describe(`given a generated GTK app with @media variants, resized ${how}`, { skip: (!canRun && SKIP) || (resizeWith === 'xdotool' && !canXdotool && 'needs xdotool') }, () => {
    let binary = '';
    let stretched = '';
    before(() => {
      const first = build(resizeIr());
      const second = build(stretchIr());
      dirs.push(first.dir, second.dir);
      binary = first.binary;
      stretched = second.binary;
    });

    it('when the window opens narrow, then the base layout applies (a column)', () => {
      assert.match(frames(binary, resizeWith)[0], new RegExp(`^320x\\d+ ${COLUMN}$`));
    });
    it('when the window is resized wider, then the variants apply: a row with its own gap, padding and widths', () => {
      assert.match(frames(binary, resizeWith, RESIZE)[1], new RegExp(`^500x\\d+ ${ROW}$`));
    });
    it('when the window is made narrow again, then the base layout returns', () => {
      assert.match(frames(binary, resizeWith, RESIZE, BACK)[2], new RegExp(`^320x\\d+ ${COLUMN}$`));
    });
    it('when a stretched column is resized wider, then it becomes a row with a fixed first child and a growing second one', () => {
      const lines = frames(stretched, resizeWith, RESIZE, BACK);
      assert.match(lines[0], new RegExp(`^320x\\d+ ${STRETCH_COLUMN}$`));
      assert.match(lines[1], new RegExp(`^500x\\d+ ${STRETCH_ROW}$`));
      assert.match(lines[2], new RegExp(`^320x\\d+ ${STRETCH_COLUMN}$`));
    });
  });
}
