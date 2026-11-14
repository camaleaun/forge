import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateProject, writeProjectFiles } from '../../../src/gen/index.ts';
import type { Ir } from '../../../src/ir/types.ts';
import { helloIr, node } from '../helpers.ts';

const cxx = ['c++', 'g++', 'clang++'].find((name) => spawnSync(name, ['--version']).status === 0);
const gtk = spawnSync('pkg-config', ['--cflags', 'gtk4'], { encoding: 'utf8' });
const skip = (!cxx || gtk.status !== 0) && 'needs a C++ compiler and the gtk4 development files (pkg-config gtk4)';
const dirs: string[] = [];

// Nested row, flex, styles, justify center and space-between, a handler without effects, a state-bound button.
function richIr(): Ir {
  const ir = helloIr();
  ir.states.push({ id: 's1', initial: { kind: 'literal', value: 'Go "now"' } });
  ir.handlers.push({ id: 'reset', effects: [] });
  ir.root.style = { width: 400, height: 200, alignItems: 'stretch', justifyContent: 'space-between', gap: 8, padding: [4, 5, 6, 7], background: '#102030ff', borderRadius: 6 };
  ir.root.children.push(
    node('view', 'row', {
      style: { flexDirection: 'row', alignItems: 'center', justifyContent: 'end', gap: 3, height: 40, background: '#ffffff80' },
      children: [
        node('text', 'grow', { content: { kind: 'literal', value: 'Grow' }, style: { flex: 1, fontWeight: 700, textAlign: 'right', color: '#ff0000ff' } }),
        node('button', 'go', { content: { kind: 'state', state: 's1' }, on: { click: 'reset' }, style: { fontSize: 11 } }),
      ],
    }),
    node('view', 'mid', { style: { justifyContent: 'center' }, children: [node('text', 'm', { content: { kind: 'literal', value: 'Mid' } })] }),
  );
  return ir;
}

for (const [label, make] of [['hello', helloIr], ['rich', richIr]] as const) {
  describe(`given the generated Linux ${label} sources`, { skip }, () => {
    let dir = '';
    before(() => {
      dir = mkdtempSync(join(tmpdir(), 'forge-gen-linux-syntax-'));
      dirs.push(dir);
      writeProjectFiles(generateProject(make(), 'linux'), dir);
    });
    for (const file of ['actions.cpp', 'cli_router.cpp', 'ui_linux.cpp']) {
      it(`when ${file} is compiled with -fsyntax-only, then the compiler accepts it without warnings`, () => {
        const flags = file === 'ui_linux.cpp' ? gtk.stdout.trim().split(/\s+/) : [];
        const result = spawnSync(cxx!, ['-std=c++20', '-Wall', '-Wextra', '-Werror', '-fsyntax-only', '-I', dir, ...flags, join(dir, file)], { encoding: 'utf8' });
        assert.equal(result.stderr, '');
        assert.equal(result.status, 0);
      });
    }
  });
}

after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});
