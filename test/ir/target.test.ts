import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildIr } from '../../src/ir/build.ts';
import { h } from '../../src/ir/runtime.ts';
import { state, resetStates } from '../../src/ir/state.ts';

const app = { name: 'hello', version: '0.1.0' };
const LIST = 'macos | linux | windows | web | android | ios';

describe('given target conditionals <only> and <except>', () => {
  const tree = (...children: unknown[]) => () => h('window', { 'forge:loc': [1, 1] }, ...children);
  const run = (App: () => unknown, target?: string, extra: object = {}) => buildIr({ file: 'App.tsx', app, App, target, ...extra } as never);
  const ids = (App: () => unknown, target?: string) => run(App, target).ir?.root.children.map((c) => c.id);
  const only = (names: Record<string, true>, ...children: unknown[]) => h('only', { 'forge:loc': [2, 3], ...names }, ...children);
  const except = (names: Record<string, true>, ...children: unknown[]) => h('except', { 'forge:loc': [2, 3], ...names }, ...children);

  it('when <only macos linux> wraps a child, then the child stays on macos and linux and is absent on web', () => {
    const App = tree(h('view', { id: 'a' }), only({ macos: true, linux: true }, h('view', { id: 'b' })));
    assert.deepEqual(ids(App, 'macos'), ['a', 'b']);
    assert.deepEqual(ids(App, 'linux'), ['a', 'b']);
    assert.deepEqual(ids(App, 'web'), ['a']);
  });

  it('when <except web> wraps a child, then the child is absent on web only', () => {
    const App = tree(except({ web: true }, h('view', { id: 'b' })));
    assert.deepEqual(ids(App, 'web'), []);
    assert.deepEqual(ids(App, 'macos'), ['b']);
  });

  it('when no target is given, then the preview target web is assumed', () => {
    const App = tree(only({ web: true }, h('view', { id: 'w' })), only({ macos: true }, h('view', { id: 'm' })));
    assert.deepEqual(ids(App), ['w']);
  });

  it('when <only> has no targets, then it reports App.tsx:L:C', () => {
    assert.deepEqual(run(tree(only({}, h('view', {})))).errors, [`App.tsx:2:3: <only> needs at least one target (${LIST})`]);
  });

  it('when a target is unknown, then it reports the valid names', () => {
    assert.deepEqual(run(tree(except({ beos: true }, h('view', {})))).errors, [`App.tsx:2:3: unknown target "beos" in <except> (expected ${LIST})`]);
  });

  it('when <only> mixes in except, then it reports the mix', () => {
    assert.deepEqual(run(tree(only({ macos: true, except: true }, h('view', {})))).errors,
      ['App.tsx:2:3: <only> cannot mix only and except: nest one tag in the other']);
  });

  it('when <only> has text or state children, then it reports them even when the target does not match', () => {
    resetStates();
    const s = state('x');
    assert.deepEqual(run(tree(only({ macos: true }, 'hi')), 'web').errors, ['App.tsx:2:3: <only> can only contain elements, not text or state']);
    assert.deepEqual(run(tree(except({ macos: true }, s)), 'web').errors, ['App.tsx:2:3: <except> can only contain elements, not text or state']);
  });

  it('when the build target is unknown, then it reports the valid names', () => {
    assert.deepEqual(run(tree(), 'beos').errors, [`unknown target "beos" (expected ${LIST})`]);
  });

  it('when <only> wraps the root window, then it is an error', () => {
    const App = () => h('only', { macos: true, 'forge:loc': [1, 1] }, h('window', { 'forge:loc': [2, 3] }));
    assert.deepEqual(run(App, 'macos').errors, ['App.tsx:1:1: <only> cannot wrap the root <window>']);
  });

  it('when <only> is the window child list, then it works like a fragment on a matching target', () => {
    const App = tree(only({ macos: true }, h('view', { id: 'x' }), h('view', { id: 'y' })));
    assert.deepEqual(ids(App, 'macos'), ['x', 'y']);
  });

  it('when <only macos> surrounds <select language> on web without languages/, then it is fine; on macos it is still checked', () => {
    const App = tree(only({ macos: true }, h('select', { language: true, 'forge:loc': [3, 5] })));
    assert.deepEqual(run(App, 'web').errors, []);
    assert.deepEqual(run(App, 'macos').errors, ['App.tsx:3:5: <select language> needs an languages/ folder with at least one language file']);
    assert.deepEqual(run(App, 'macos', { translateLiterals: true }).errors, []);
  });

  it('when <only> is nested in <only>, then both must match', () => {
    const App = tree(only({ macos: true, linux: true }, only({ linux: true }, h('view', { id: 'x' }))));
    assert.deepEqual(ids(App, 'linux'), ['x']);
    assert.deepEqual(ids(App, 'macos'), []);
  });
});
