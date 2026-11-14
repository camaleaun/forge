import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateProject } from '../../../src/gen/index.ts';
import type { Ir } from '../../../src/ir/types.ts';
import { helloIr, node } from '../helpers.ts';

const hasClang = spawnSync('clang++', ['--version']).status === 0;
const dirs: string[] = [];

// A richer IR: nested row view, flex, styles, two buttons, a handler without effects, state-bound button.
function richIr(): Ir {
  const ir = helloIr();
  ir.states.push({ id: 's1', initial: 'Go "now"' });
  ir.handlers.push({ id: 'reset', effects: [] });
  ir.root.style = { width: 400, height: 200, flexDirection: 'column', alignItems: 'stretch', justifyContent: 'space-between', gap: 8, padding: [4, 5, 6, 7], background: '#102030ff', borderRadius: 6 };
  ir.root.children.push(
    node('view', 'row', {
      style: { flexDirection: 'row', alignItems: 'center', justifyContent: 'end', gap: 3, height: 40, background: '#ffffff80' },
      children: [
        node('text', 'grow', { content: { kind: 'literal', value: 'Grow' }, style: { flex: 1, fontWeight: 700, textAlign: 'right', color: '#ff0000ff' } }),
        node('button', 'go', { content: { kind: 'state', state: 's1' }, on: { click: 'reset' }, style: { fontSize: 11 } }),
      ],
    }),
  );
  return ir;
}

function write(ir: Ir): string {
  const dir = mkdtempSync(join(tmpdir(), 'forge-gen-syntax-'));
  dirs.push(dir);
  for (const [name, content] of generateProject(ir, 'macos')) writeFileSync(join(dir, name), content);
  return dir;
}

function check(dir: string, file: string, extra: string[] = []) {
  return spawnSync('clang++', ['-std=c++20', '-Wall', '-Wextra', '-Werror', '-fsyntax-only', '-I', dir, ...extra, join(dir, file)], { encoding: 'utf8' });
}

const MM_FLAGS = ['-x', 'objective-c++', '-fobjc-arc', '-Wno-deprecated-declarations'];

for (const [label, make] of [['hello', helloIr], ['rich', richIr]] as const) {
  describe(`given the generated ${label} sources`, { skip: !hasClang && 'clang++ not installed' }, () => {
    let dir = '';
    before(() => {
      dir = write(make());
    });

    for (const file of ['actions.cpp', 'cli_router.cpp']) {
      it(`when ${file} is compiled with clang++ -fsyntax-only, then clang accepts it without warnings`, () => {
        const result = check(dir, file);
        assert.equal(result.stderr, '');
        assert.equal(result.status, 0);
      });
    }

    it('when ui_macos.mm is compiled as Objective-C++ with ARC, then clang accepts it', { skip: process.platform !== 'darwin' && 'macOS only' }, () => {
      const result = check(dir, 'ui_macos.mm', MM_FLAGS);
      assert.equal(result.stderr, '');
      assert.equal(result.status, 0);
    });
  });
}

after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});
