import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildIr } from '../../src/ir/build.ts';
import { h } from '../../src/ir/runtime.ts';
import { state, resetStates } from '../../src/ir/state.ts';
import { helloApp } from './helpers.ts';

const app = { name: 'hello', version: '0.1.0' };

describe('given the hello app', () => {
  it('when building the IR, then it has the window tree, the state, the handler and the command', () => {
    const { App, commands } = helloApp();
    const { ir, errors } = buildIr({ file: 'App.tsx', app, App, commands });
    assert.deepEqual(errors, []);
    assert.deepEqual(ir, {
      irVersion: 1,
      app,
      root: {
        kind: 'window', id: 'window_0', classes: [], title: 'Hello, forge', style: {}, loc: [7, 5],
        children: [
          { kind: 'text', id: 'text_1', classes: ['message'], content: { kind: 'state', state: 's0' }, style: {}, children: [], loc: [8, 7] },
          { kind: 'button', id: 'button_2', classes: [], content: { kind: 'literal', value: 'Greet' }, on: { click: 'greet' }, style: {}, children: [], loc: [9, 7] },
        ],
      },
      states: [{ id: 's0', initial: 'Press the button' }],
      handlers: [{ id: 'greet', effects: [{ op: 'set', state: 's0', value: { kind: 'literal', value: 'Hello, world!' } }] }],
      commands: [{ flag: '--greet', description: 'Print the greeting', handler: 'greet' }],
    });
  });
});


function errorsOf(tree: unknown, overrides: { app?: { name: string; version: string }; commands?: Record<string, { description: string; run: () => void }> } = {}) {
  return buildIr({ file: 'App.tsx', app: overrides.app ?? app, App: () => tree, commands: overrides.commands }).errors;
}

describe('given an app whose structure is invalid', () => {
  it('when the root is not a window, then it reports the root element', () => {
    assert.deepEqual(errorsOf(h('view', { 'forge:loc': [2, 3] })), ['App.tsx:2:3: the root element must be <window>']);
  });

  it('when an element is unknown, then it reports the element and the supported ones', () => {
    assert.deepEqual(
      errorsOf(h('window', { 'forge:loc': [1, 1] }, h('div', { 'forge:loc': [3, 7] }))),
      ['App.tsx:3:7: unknown element <div> (expected window | view | text | button)'],
    );
  });

  it('when onClick is on a text, then it reports that only buttons take onClick', () => {
    resetStates();
    const tree = h('window', { 'forge:loc': [1, 1] }, h('text', { onClick: () => {}, 'forge:loc': [4, 7] }, 'hi'));
    assert.deepEqual(errorsOf(tree), ['App.tsx:4:7: onClick is only supported on <button>']);
  });

  it('when a text mixes plain text and a state, then it reports that mixing is not supported in v1', () => {
    resetStates();
    const message = state('x');
    const tree = h('window', { 'forge:loc': [1, 1] }, h('text', { 'forge:loc': [5, 7] }, 'Hi ', message));
    assert.deepEqual(errorsOf(tree), ['App.tsx:5:7: <text> cannot mix text and state in v1']);
  });
});

describe('given ids in the tree', () => {
  it('when two elements share an id, then it reports the second one', () => {
    const tree = h('window', { 'forge:loc': [1, 1] },
      h('text', { id: 'label', 'forge:loc': [2, 3] }, 'a'),
      h('text', { id: 'label', 'forge:loc': [3, 3] }, 'b'));
    assert.deepEqual(errorsOf(tree), ['App.tsx:3:3: duplicate id "label"']);
  });

  for (const id of ['my-id', '1st', 'Label', 'class']) {
    it(`when the id is "${id}", then it reports an invalid id`, () => {
      const tree = h('window', { 'forge:loc': [1, 1] }, h('text', { id, 'forge:loc': [2, 3] }, 'a'));
      assert.deepEqual(errorsOf(tree), [`App.tsx:2:3: invalid id "${id}" (must match /^[a-z][A-Za-z0-9_]*$/ and not be a C++ keyword)`]);
    });
  }

  for (const id of ['forge_x', 's1', 'handler_2']) {
    it(`when the id "${id}" uses a reserved prefix, then it reports it`, () => {
      const tree = h('window', { 'forge:loc': [1, 1] }, h('text', { id, 'forge:loc': [2, 3] }, 'a'));
      assert.deepEqual(errorsOf(tree), [`App.tsx:2:3: id "${id}" uses a name that forge reserves`]);
    });
  }
});

describe('given commands, the app name and the version', () => {
  const tree = () => h('window', { 'forge:loc': [1, 1] });
  const run = () => {};

  it('when a flag is reserved, does not start with "--" or is repeated, then each is reported', () => {
    assert.deepEqual(errorsOf(tree(), { commands: { '--help': { description: 'x', run } } }), ['App.tsx: command "--help" is reserved']);
    assert.deepEqual(errorsOf(tree(), { commands: { '--forge-debug': { description: 'x', run } } }), ['App.tsx: command "--forge-debug" is reserved']);
    assert.deepEqual(errorsOf(tree(), { commands: { greet: { description: 'x', run } } }), ['App.tsx: command "greet" must start with "--"']);
  });

  it('when the version is not semver, then it reports package.json', () => {
    assert.deepEqual(errorsOf(tree(), { app: { name: 'hello', version: '1.0' } }), ['package.json: version "1.0" must be semver x.y.z']);
  });

  it('when the name is not a slug, then it reports package.json', () => {
    assert.deepEqual(errorsOf(tree(), { app: { name: 'My App', version: '0.1.0' } }), ['package.json: name "My App" must match /^[a-z][a-z0-9-]*$/']);
  });
});

describe('given a handler that cannot be traced', () => {
  it('when it is async, then the build reports it instead of throwing', () => {
    resetStates();
    const tree = h('window', { 'forge:loc': [1, 1] }, h('button', { onClick: async function greet() {}, 'forge:loc': [2, 3] }, 'Go'));
    assert.deepEqual(errorsOf(tree), ['handler "greet": handlers must be synchronous in v1']);
  });
});
