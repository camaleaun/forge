import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildIr } from '../../src/ir/build.ts';
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
