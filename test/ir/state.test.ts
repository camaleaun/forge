import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { state, resetStates, registeredStates, traceHandler } from '../../src/ir/state.ts';
import { __, _n, sprintf } from '../../src/i18n/message.ts';

describe('given states created in order', () => {
  beforeEach(() => resetStates());

  it('when creating two states, then they get the ids s0 and s1 and keep their initial text', () => {
    const a = state('first');
    const b = state('second');
    assert.deepEqual([a.id, a.initial, b.id, b.initial], ['s0', { kind: 'literal', value: 'first' }, 's1', { kind: 'literal', value: 'second' }]);
    assert.deepEqual(registeredStates().map((s) => s.id), ['s0', 's1']);
  });

  it('when resetting, then the numbering starts again at s0', () => {
    state('x');
    resetStates();
    assert.equal(state('y').id, 's0');
  });
});

describe('given a state value that a handler tries to read', () => {
  beforeEach(() => resetStates());

  it('when it is used in a template literal or String(), then it throws because values cannot be read in v1', () => {
    const message = state('Hi');
    const expected = { message: 'state values cannot be read in v1; bind the state as a child instead' };
    assert.throws(() => `${message}`, expected);
    assert.throws(() => String(message), expected);
    assert.throws(() => message + '!', expected);
  });
});

describe('given set() called outside a handler', () => {
  beforeEach(() => resetStates());

  it('when the app module calls state.set() at load time, then it throws', () => {
    const message = state('Hi');
    assert.throws(() => message.set('x'), { message: 'state.set() can only run inside a handler' });
  });
});

describe('given a handler traced at build time', () => {
  beforeEach(() => resetStates());

  it('when it sets a state, then the trace holds one set effect with the literal value', () => {
    const message = state('Press');
    assert.deepEqual(traceHandler('greet', () => message.set('Hello, world!')), [
      { op: 'set', state: 's0', value: { kind: 'literal', value: 'Hello, world!' } },
    ]);
  });

  it('when it is async, then tracing fails because handlers must be synchronous in v1', () => {
    assert.throws(
      () => traceHandler('greet', async () => {}),
      { message: 'handler "greet": handlers must be synchronous in v1' },
    );
  });

  it('when it throws, then the error names the handler and keeps the original as cause', () => {
    const original = new Error('boom');
    assert.throws(
      () => traceHandler('bad', () => { throw original; }),
      (error: Error) => error.message === 'handler "bad": boom' && error.cause === original,
    );
  });

  it('when it sets a non-string value, then tracing fails naming the state', () => {
    const count = state('0');
    assert.throws(
      () => traceHandler('bad', () => count.set(5 as never)),
      { message: 'handler "bad": state "s0".set() expects a string or a message' },
    );
  });

  it('when tracing ends, then set() is refused again', () => {
    const message = state('x');
    traceHandler('ok', () => message.set('y'));
    assert.throws(() => message.set('z'), { message: 'state.set() can only run inside a handler' });
  });
});

describe('given states and handlers that use translatable messages', () => {
  beforeEach(() => resetStates());

  it('when a state starts with a message, then its initial value is a message text', () => {
    const message = state(__('Press the button'));
    assert.deepEqual(message.initial, { kind: 'message', text: 'Press the button' });
  });

  it('when a handler sets a message (plural and arguments included), then the effect carries the message', () => {
    const message = state('x');
    const effects = traceHandler('count', () => message.set(sprintf(_n('%d file', '%d files', 3), 3)));
    assert.deepEqual(effects, [
      { op: 'set', state: 's0', value: { kind: 'message', text: '%d file', plural: '%d files', count: 3, args: [3] } },
    ]);
  });
});
