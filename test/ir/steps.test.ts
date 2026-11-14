import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildIr } from '../../src/ir/build.ts';
import { h } from '../../src/ir/runtime.ts';
import { state, resetStates, traceHandler, next, back, quit, goTo } from '../../src/ir/state.ts';

const app = { name: 'hello', version: '0.1.0' };
const build = (App: () => unknown, translateLiterals = false) => buildIr({ file: 'App.tsx', app, App, translateLiterals });
const win = (...children: unknown[]) => h('window', { 'forge:loc': [1, 1] }, ...children);
const step = (props: Record<string, unknown>, ...children: unknown[]) =>
  h('step', { 'forge:loc': [3, 5], ...props }, ...(children.length ? children : [h('text', { 'forge:loc': [4, 7] }, 'x')]));
const steps = (...children: unknown[]) => h('steps', { 'forge:loc': [2, 3] }, ...children);
const errorsOf = (App: () => unknown, translateLiterals = false) => build(App, translateLiterals).errors;

describe('given a window with <steps>', () => {
  it('when each step has an id and sizes, then the IR keeps steps and step nodes with width and height', () => {
    const { ir, errors } = build(() => win(steps(step({ id: 'a', width: 420, height: 180 }), step({ id: 'b' }))));
    assert.deepEqual(errors, []);
    const [container] = ir!.root.children;
    assert.equal(container.kind, 'steps');
    assert.deepEqual(container.children.map((c) => [c.kind, c.id, c.step]), [['step', 'a', { width: 420, height: 180 }], ['step', 'b', {}]]);
    assert.equal(container.children[0].children[0].kind, 'text');
  });
});

describe('given misplaced or invalid steps', () => {
  const sizeError = (name: string) => `App.tsx:3:5: <step> ${name} must be a number greater than 0, e.g. ${name}={${name === 'width' ? 420 : 180}}`;
  const cases: [string, () => unknown, string][] = [
    ['<steps> inside a view', () => win(h('view', { 'forge:loc': [2, 3] }, steps(step({ id: 'a' })))), 'App.tsx:2:3: <steps> must be a direct child of the root <window>'],
    ['two <steps>', () => win(steps(step({ id: 'a' })), h('steps', { 'forge:loc': [9, 3] }, step({ id: 'b' }))), 'App.tsx:9:3: a <window> can have only one <steps>'],
    ['content next to <steps>', () => win(steps(step({ id: 'a' })), h('text', { 'forge:loc': [8, 3] }, 'x')), 'App.tsx:8:3: a <window> with <steps> cannot have other content: put it inside the <step>s'],
    ['a non-step child', () => win(steps(h('text', { 'forge:loc': [3, 5] }, 'x'))), 'App.tsx:3:5: <steps> can only contain <step> elements'],
    ['a text child', () => win(steps(step({ id: 'a' }), 'oops')), 'App.tsx:2:3: <steps> can only contain <step> elements'],
    ['no steps inside', () => win(steps()), 'App.tsx:2:3: <steps> needs at least one <step>'],
    ['a step without id', () => win(steps(step({}))), 'App.tsx:3:5: <step> needs an id, e.g. <step id="welcome">'],
    ['duplicate step ids', () => win(steps(step({ id: 'a' }), step({ id: 'a', 'forge:loc': [6, 5] }))), 'App.tsx:6:5: duplicate id "a"'],
    ['a string width', () => win(steps(step({ id: 'a', width: '420' }))), sizeError('width')],
    ['a zero height', () => win(steps(step({ id: 'a', height: 0 }))), sizeError('height')],
    ['a negative width', () => win(steps(step({ id: 'a', width: -5 }))), sizeError('width')],
    ['an empty step', () => win(steps(h('step', { id: 'a', 'forge:loc': [3, 5] }))), 'App.tsx:3:5: <step> needs at least one child element'],
    ['a step outside <steps>', () => win(step({ id: 'a' })), 'App.tsx:3:5: <step> must be a direct child of <steps>'],
  ];
  for (const [name, App, message] of cases) {
    it(`when there is ${name}, then the error says "${message}"`, () => {
      assert.ok(errorsOf(App).includes(message), errorsOf(App).join('\n'));
    });
  }
});

describe('given the navigation handlers', () => {
  beforeEach(() => resetStates());

  it('when tracing next, back, quit and goTo, then the effects are go and quit', () => {
    assert.deepEqual(traceHandler('x', next), [{ op: 'go', to: 'next' }]);
    assert.deepEqual(traceHandler('x', back), [{ op: 'go', to: 'back' }]);
    assert.deepEqual(traceHandler('x', quit), [{ op: 'quit' }]);
    assert.deepEqual(traceHandler('x', goTo('hello')), [{ op: 'go', to: { step: 'hello' } }]);
  });

  it('when a handler sets state then goes, then the order is kept', () => {
    const message = state('a');
    const both = () => { message.set('b'); next(); message.set('c'); };
    assert.deepEqual(traceHandler('both', both).map((e) => e.op), ['set', 'go', 'set']);
  });

  it('when goTo gets something that is not a string, then it throws', () => {
    assert.throws(() => goTo(3 as unknown as string), /goTo\(\) expects a step id/);
  });

  it('when next runs outside a handler, then it throws', () => {
    assert.throws(() => next(), /can only run inside a handler/);
  });
});

describe('given buttons that navigate', () => {
  beforeEach(() => resetStates());
  const two = (onClick: () => void) => () =>
    win(steps(step({ id: 'a' }, h('button', { onClick, 'forge:loc': [5, 9] }, 'Go')), step({ id: 'b' })));

  it('when a button uses next, then the handler is in the IR with the go effect', () => {
    const { ir, errors } = build(two(next));
    assert.deepEqual(errors, []);
    assert.deepEqual(ir!.handlers, [{ id: 'next', effects: [{ op: 'go', to: 'next' }] }]);
    assert.equal(ir!.root.children[0].children[0].children[0].on?.click, 'next');
  });

  it('when goTo names a step that exists, then it builds', () => {
    assert.deepEqual(build(two(goTo('b'))).errors, []);
  });

  it('when goTo names a missing step, then the error has the button position', () => {
    assert.deepEqual(errorsOf(two(goTo('nope'))), ['App.tsx:5:9: goTo("nope"): there is no <step id="nope">']);
  });

  it('when the app has no <steps>, then next, back and goTo are errors but quit is allowed', () => {
    const plain = (onClick: () => void) => () => win(h('button', { onClick, 'forge:loc': [5, 9] }, 'Go'));
    assert.deepEqual(errorsOf(plain(next)), ['App.tsx:5:9: navigation (next, back, goTo) needs a <steps> in the <window>']);
    assert.equal(errorsOf(plain(goTo('a'))).length, 1);
    assert.deepEqual(build(plain(quit)).errors, []);
    assert.deepEqual(build(plain(quit)).ir!.handlers, [{ id: 'quit', effects: [{ op: 'quit' }] }]);
  });
});

describe('given a button with waitsForDownload', () => {
  const btn = (props: Record<string, unknown>, kind = 'button') => () => win(h(kind, { 'forge:loc': [2, 3], ...props }, 'OK'));

  it('when the project has languages, then the IR node says disabledDuringDownload', () => {
    const { ir, errors } = build(btn({ waitsForDownload: true }), true);
    assert.deepEqual(errors, []);
    assert.equal(ir!.root.children[0].disabledDuringDownload, true);
  });

  it('when there is no languages folder, then it is an error', () => {
    assert.deepEqual(errorsOf(btn({ waitsForDownload: true })), ['App.tsx:2:3: <button waitsForDownload> needs an languages/ folder with at least one language file']);
  });

  it('when it is not a bare attribute or not on a button, then it is an error', () => {
    assert.deepEqual(errorsOf(btn({ waitsForDownload: 'yes' }), true), ['App.tsx:2:3: waitsForDownload is a bare attribute']);
    assert.deepEqual(errorsOf(btn({ waitsForDownload: true }, 'text'), true), ['App.tsx:2:3: waitsForDownload is only supported on <button>']);
  });
});

describe('given a CLI command whose handler navigates', () => {
  beforeEach(() => resetStates());
  it('when building, then the command is rejected (commands run without a window)', () => {
    const { errors } = buildIr({ file: 'App.tsx', app, App: () => win(steps(step({ id: 'a' }))), commands: { '--go': { description: 'Go', run: next } } });
    assert.ok(errors.includes('App.tsx: command "--go" cannot navigate between steps'), errors.join('\n'));
  });
});
