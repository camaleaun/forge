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
import type { Ir } from '../../../src/ir/types.ts';
import { footerIr, stepsIr } from './steps-irs.ts';

const has = (command: string, args: string[]): boolean => spawnSync(command, args).status === 0;
const gtk = spawnSync('pkg-config', ['--cflags', '--libs', 'gtk4'], { encoding: 'utf8' });
const canRun = process.platform === 'linux' && has('g++', ['--version']) && gtk.status === 0 && has('sh', ['-c', 'command -v xvfb-run']);
const dir = mkdtempSync(join(tmpdir(), 'forge-gen-steps-linux-'));
const binary = join(dir, 'app');
after(() => rmSync(dir, { recursive: true, force: true }));

const footerBinary = join(dir, 'footer');

function compile(ir: Ir, out: string): void {
  const sub = mkdtempSync(join(dir, 'p-'));
  writeProjectFiles(generateProject(ir, 'linux'), sub);
  const result = spawnSync('g++', [
    '-std=c++20', '-Wall', '-Wextra', '-Werror', '-Wno-unused-function', '-I', sub, '-I', RUNTIME_DIR,
    join(ROOT, 'test/gen/fixtures/ui_steps_driver.cpp'), join(sub, 'ui_linux.cpp'), join(sub, 'actions.cpp'), ...gtk.stdout.trim().split(/\s+/), '-o', out,
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

before(() => {
  if (!canRun) return;
  compile(stepsIr(), binary);
  compile(footerIr(), footerBinary);
});

function output(program: string, args: string[], extra: Record<string, string> = {}): string[] {
  const env = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', GDK_BACKEND: 'x11', ...extra };
  const run = has('dbus-run-session', ['--version']) ? ['dbus-run-session', '--', program, ...args] : [program, ...args];
  const result = spawnSync('xvfb-run', ['-a', '-s', '-screen 0 1280x800x24', ...run], { encoding: 'utf8', env, timeout: 60000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout.trim().split('\n');
}

function lines(...clicks: string[]): string[] {
  return output(binary, clicks).filter((line) => /^\d+x\d+ resizable=/.test(line));
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
  it('when Enter activates the default widget, then the primary button of the visible screen fires; Escape reaches the cancel button (both stop at the ends)', () => {
    assert.deepEqual(lines('key:Enter', 'key:Enter', 'key:Escape', 'key:Escape').map((line) => line.slice(0, 7)), ['420x180', '600x200', '600x200', '420x180', '420x180']);
  });
  it('when Quit is clicked, then the app ends by itself (no further report)', () => {
    assert.equal(lines('Next', 'Quit').length, 2);
  });
});

type Rect = { x: number; y: number; w: number; h: number };

// The rectangles of the footer app (x,y,w,h from the top left of the content) after each size, by name.
function rects(...resizes: string[]): Record<string, Rect>[] {
  return output(footerBinary, resizes, { FORGE_GEOMETRY: '1' })
    .filter((line) => line.startsWith('geometry'))
    .map((line) => Object.fromEntries(line.split(' ').slice(1).map((token) => {
      const [name, numbers] = token.split('=');
      const [x, y, w, h] = numbers.split(',').map(Number);
      return [name, { x, y, w, h }];
    })));
}

// GTK's theme may make a button larger than the 85x24 asked for (it is a minimum): the edges and the gap are what the CSS fixes.
describe('given a screen made of plain views (a growing content, a 1 px divider and a footer row), in a real window', { skip: !canRun && 'needs Linux with g++, GTK 4 and xvfb-run' }, () => {
  for (const [size, width, height] of [['600x440', 600, 440], ['700x500', 700, 500]] as const) {
    it(`when the window is ${size}, then the footer is pinned to the bottom right (14 px margins, 12 px gap) under a 1 px full-width line`, () => {
      const { Back, Close, line } = rects(...(size === '600x440' ? [] : [size])).at(-1)!;
      assert.ok(Back.w >= 85 && Back.h >= 24, `actual Back ${JSON.stringify(Back)}`);
      assert.equal(Close.x + Close.w, width - 14, `actual Close ${JSON.stringify(Close)}`);
      assert.equal(Close.y + Close.h, height - 14);
      assert.equal(Close.x - (Back.x + Back.w), 12);
      assert.deepEqual([line.x, line.w, line.h], [0, width, 1]);
      assert.equal(line.y + 1 + 14 + Close.h + 14, height, 'the line is right above the footer');
    });
  }
});
