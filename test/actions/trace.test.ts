import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { traceAction } from '../../src/actions/trace.ts';
import { hello } from '../helpers/fixtures.ts';

describe('given an action that sets the text of a label', () => {
  it('when traced, then it yields one setText effect', () => {
    const greet = (ui: { setText(id: string, text: string): void }) => ui.setText('message', 'Hello, world!');
    assert.deepEqual(traceAction('greet', greet, hello()), [
      { op: 'setText', target: 'message', text: 'Hello, world!' },
    ]);
  });
});

describe('given an async action', () => {
  it('when traced, then it fails because actions must be synchronous in v1', () => {
    const greet = async (ui: { setText(id: string, text: string): void }) => ui.setText('message', 'Hi');
    assert.throws(
      () => traceAction('greet', greet as never, hello()),
      { message: 'action "greet": actions must be synchronous in v1' },
    );
  });
});

describe('given an action that targets something that is not a label', () => {
  it('when it targets a button, then tracing fails naming the action and the target', () => {
    const bad = (ui: { setText(id: string, text: string): void }) => ui.setText('greet', 'x');
    assert.throws(
      () => traceAction('bad', bad, hello()),
      { message: 'action "bad": setText target "greet" is not a label' },
    );
  });

  it('when it targets an id that does not exist, then tracing fails', () => {
    const bad = (ui: { setText(id: string, text: string): void }) => ui.setText('nope', 'x');
    assert.throws(
      () => traceAction('bad', bad, hello()),
      { message: 'action "bad": setText target "nope" does not exist' },
    );
  });
});

describe('given an action that throws', () => {
  it('when traced, then the error names the action and keeps the original as cause', () => {
    const original = new Error('boom');
    const broken = () => { throw original; };
    assert.throws(
      () => traceAction('broken', broken, hello()),
      (error: Error) => error.message === 'action "broken": boom' && error.cause === original,
    );
  });
});
