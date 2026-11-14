import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { __, _n, _nx, _x, sprintf } from '../../src/i18n/message.ts';
import { collectMessages, textOf, toTextValue } from '../../src/ir/text.ts';
import type { Ir } from '../../src/ir/types.ts';

describe('given values that become IR text', () => {
  it('when converting a plain string, then it is a literal', () => {
    assert.deepEqual(toTextValue('Hi'), { kind: 'literal', value: 'Hi' });
  });

  it('when converting messages, then only the fields that are set appear', () => {
    assert.deepEqual(toTextValue(__('Hello')), { kind: 'message', text: 'Hello' });
    assert.deepEqual(toTextValue(_x('Post', 'noun')), { kind: 'message', text: 'Post', context: 'noun' });
    assert.deepEqual(toTextValue(sprintf(_n('%d file', '%d files', 3), 3)),
      { kind: 'message', text: '%d file', plural: '%d files', count: 3, args: [3] });
  });
});

describe('given an IR text, when asking for its English', () => {
  it('then a literal is returned as it is', () => {
    assert.equal(textOf({ kind: 'literal', value: 'Hi' }), 'Hi');
  });

  it('then a message is its English text with the arguments filled in', () => {
    assert.equal(textOf(toTextValue(sprintf(__('Hello, %s!'), 'world'))), 'Hello, world!');
  });

  it('then plurals use the English rule (singular only for exactly 1) and context is ignored', () => {
    const files = (count: number) => textOf(toTextValue(sprintf(_n('%d file', '%d files', count), count)));
    assert.deepEqual([files(0), files(1), files(2)], ['0 files', '1 file', '2 files']);
    assert.equal(textOf(toTextValue(_nx('%d post', '%d posts', 1, 'blog'))), '%d post');
  });
});

describe('given an IR with messages in several places', () => {
  const ir = {
    app: { name: 'a', version: '0.1.0' },
    root: { kind: 'window', id: 'window_0', classes: [], style: {}, loc: [1, 1], title: toTextValue(__('Hello, forge')),
      children: [
        { kind: 'text', id: 'text_1', classes: [], style: {}, loc: [2, 1], children: [], content: toTextValue(__('Greet')) },
        { kind: 'button', id: 'button_2', classes: [], style: {}, loc: [3, 1], children: [], content: { kind: 'literal', value: 'plain' } },
      ] },
    states: [{ id: 's0', initial: toTextValue(_x('Post', 'noun')) }],
    handlers: [{ id: 'h', effects: [{ op: 'set', state: 's0', value: toTextValue(_n('%d file', '%d files', 2)) }] }],
    commands: [{ flag: '--go', description: toTextValue(__('Greet')), handler: 'h' }],
  } as unknown as Ir;

  it('when collecting the messages, then each distinct text appears once, sorted by context then text, and literals are ignored', () => {
    assert.deepEqual(collectMessages(ir), [
      { text: '%d file', plural: '%d files' },
      { text: 'Greet' },
      { text: 'Hello, forge' },
      { context: 'noun', text: 'Post' },
    ]);
  });
});
