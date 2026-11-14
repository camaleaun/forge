import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildIr } from '../../src/ir/build.ts';
import { h } from '../../src/ir/runtime.ts';
import { state, resetStates } from '../../src/ir/state.ts';
import { __, _n, _x, sprintf } from '../../src/i18n/message.ts';
import { helloApp } from './helpers.ts';

const app = { name: 'hello', version: '0.1.0' };

describe('given the hello app', () => {
  it('when building the IR, then it has the window tree, the state, the handler and the command', () => {
    const { App, commands } = helloApp();
    const { ir, errors } = buildIr({ file: 'App.tsx', app, App, commands });
    assert.deepEqual(errors, []);
    assert.deepEqual(ir, {
      irVersion: 2,
      app,
      root: {
        kind: 'window', id: 'window_0', classes: [], title: { kind: 'literal', value: 'Hello, forge' }, style: {}, loc: [7, 5],
        children: [
          { kind: 'text', id: 'text_1', classes: ['message'], content: { kind: 'state', state: 's0' }, style: {}, children: [], loc: [8, 7] },
          { kind: 'button', id: 'button_2', classes: [], content: { kind: 'literal', value: 'Greet' }, on: { click: 'greet' }, style: {}, children: [], loc: [9, 7] },
        ],
      },
      states: [{ id: 's0', initial: { kind: 'literal', value: 'Press the button' } }],
      messages: [],
      handlers: [{ id: 'greet', effects: [{ op: 'set', state: 's0', value: { kind: 'literal', value: 'Hello, world!' } }] }],
      commands: [{ flag: '--greet', description: { kind: 'literal', value: 'Print the greeting' }, handler: 'greet' }],
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
      ['App.tsx:3:7: unknown element <div> (expected window | view | text | button | select)'],
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

describe('given an app that uses translatable messages', () => {
  const build = (App: () => unknown, extra: { commands?: Record<string, { description: never; run: () => void }>; translateLiterals?: boolean } = {}) =>
    buildIr({ file: 'App.tsx', app, App, ...extra } as never);

  it('when the title, the content, a state, an effect and a command description are messages, then the IR keeps them and lists each text once', () => {
    resetStates();
    const message = state(__('Press the button'));
    const greet = function greet() { message.set(__('Hello, world!')); };
    const tree = () => h('window', { title: __('Hello, forge'), 'forge:loc': [1, 1] },
      h('text', { 'forge:loc': [2, 3] }, message),
      h('button', { onClick: greet, 'forge:loc': [3, 3] }, __('Greet')));
    const { ir, errors } = build(tree, { commands: { '--greet': { description: __('Greet') as never, run: greet } } });
    assert.deepEqual(errors, []);
    assert.equal(ir?.irVersion, 2);
    assert.deepEqual(ir?.root.title, { kind: 'message', text: 'Hello, forge' });
    assert.deepEqual(ir?.root.children[1].content, { kind: 'message', text: 'Greet' });
    assert.deepEqual(ir?.states[0].initial, { kind: 'message', text: 'Press the button' });
    assert.deepEqual(ir?.handlers[0].effects[0].value, { kind: 'message', text: 'Hello, world!' });
    assert.deepEqual(ir?.commands[0].description, { kind: 'message', text: 'Greet' });
    assert.deepEqual(ir?.messages.map((m) => m.text), ['Greet', 'Hello, forge', 'Hello, world!', 'Press the button']);
  });

  it('when a message has a context and a plural, then they reach the IR and the list', () => {
    resetStates();
    const tree = () => h('window', { 'forge:loc': [1, 1] },
      h('text', { 'forge:loc': [2, 3] }, _x('Post', 'noun')),
      h('text', { 'forge:loc': [3, 3] }, sprintf(_n('%d file', '%d files', 3), 3)));
    const { ir } = build(tree);
    assert.deepEqual(ir?.root.children[0].content, { kind: 'message', text: 'Post', context: 'noun' });
    assert.deepEqual(ir?.root.children[1].content, { kind: 'message', text: '%d file', plural: '%d files', count: 3, args: [3] });
    assert.deepEqual(ir?.messages, [{ text: '%d file', plural: '%d files' }, { context: 'noun', text: 'Post' }]);
  });

  it('when a text mixes a message with other content, then it reports it', () => {
    resetStates();
    const tree = () => h('window', { 'forge:loc': [1, 1] }, h('text', { 'forge:loc': [2, 3] }, 'Hi ', __('there')));
    assert.deepEqual(build(tree).errors, ['App.tsx:2:3: <text> cannot mix a message with other content in v1']);
  });

  it('when the same text is used with two different plurals, then it reports the conflict', () => {
    resetStates();
    const tree = () => h('window', { 'forge:loc': [1, 1] },
      h('text', { 'forge:loc': [2, 3] }, _n('%d file', '%d files', 2)),
      h('text', { 'forge:loc': [3, 3] }, _n('%d file', '%d documents', 2)));
    assert.deepEqual(build(tree).errors, ['App.tsx: the text "%d file" is used with two different plurals: "%d files" and "%d documents"']);
  });
});

describe('given a project that has a languages folder', () => {
  const tree = () => h('window', { title: 'Hello, forge', 'forge:loc': [1, 1] },
    h('text', { 'forge:loc': [2, 3] }, 'Greet'),
    h('button', { 'forge:loc': [3, 3] }, 'Go'));
  const run = (translateLiterals: boolean) => buildIr({ file: 'App.tsx', app, App: tree, translateLiterals });

  it('when building with translateLiterals, then literal JSX text and the window title become messages', () => {
    resetStates();
    const { ir } = run(true);
    assert.deepEqual(ir?.root.title, { kind: 'message', text: 'Hello, forge' });
    assert.deepEqual(ir?.root.children.map((c) => c.content), [{ kind: 'message', text: 'Greet' }, { kind: 'message', text: 'Go' }]);
    assert.deepEqual(ir?.messages.map((m) => m.text), ['Go', 'Greet', 'Hello, forge']);
  });

  it('when building without it, then everything stays literal and the message list is empty', () => {
    resetStates();
    const { ir } = run(false);
    assert.deepEqual(ir?.root.title, { kind: 'literal', value: 'Hello, forge' });
    assert.deepEqual(ir?.messages, []);
  });
});

describe('given a language dropdown', () => {
  const withSelect = (props: Record<string, unknown>, children: unknown[] = []) => () =>
    h('window', { 'forge:loc': [1, 1] }, h('select', { 'forge:loc': [2, 3], ...props }, ...children));
  const run = (tree: () => unknown, translateLiterals = true) => buildIr({ file: 'App.tsx', app, App: tree, translateLiterals });

  it('when <select language /> is used in a project with a languages folder, then the IR has a select node marked as the language selector', () => {
    resetStates();
    const { ir, errors } = run(withSelect({ language: true }));
    assert.deepEqual(errors, []);
    const select = ir?.root.children[0];
    assert.equal(select?.kind, 'select');
    assert.deepEqual(select?.select, { language: true });
    assert.deepEqual(select?.children, []);
    assert.equal(select?.id, 'select_1');
  });

  it('when the project has no languages folder, then the build explains that a language dropdown needs one', () => {
    resetStates();
    assert.deepEqual(run(withSelect({ language: true }), false).errors,
      ['App.tsx:2:3: <select language> needs an languages/ folder with at least one language file']);
  });

  it('when <select> has no language attribute, then it is reported as unsupported in v1', () => {
    resetStates();
    assert.deepEqual(run(withSelect({})).errors, ['App.tsx:2:3: <select> is only supported with the language attribute in v1']);
  });

  it('when <select language> has children, then it is reported', () => {
    resetStates();
    assert.deepEqual(run(withSelect({ language: true }, [h('option', { 'forge:loc': [3, 5] }, 'English')])).errors,
      ['App.tsx:2:3: <select language> cannot have children: the options are the available languages']);
  });
});
