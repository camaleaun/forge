import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { placeholderCount } from '../../src/i18n/format.ts';
import { Message, __, _n, _nx, _x, sprintf } from '../../src/i18n/message.ts';

describe('given the translation functions', () => {
  it('when calling __(), then the message carries the English text only', () => {
    const message = __('Hello, world!');
    assert.ok(message instanceof Message);
    assert.deepEqual({ text: message.text, context: message.context, plural: message.plural, count: message.count, args: message.args },
      { text: 'Hello, world!', context: undefined, plural: undefined, count: undefined, args: [] });
  });

  it('when calling _x(), then the context is kept separately from the text', () => {
    const message = _x('Post', 'noun');
    assert.deepEqual([message.text, message.context], ['Post', 'noun']);
  });

  it('when calling _n(), then it holds the singular, the plural and the count', () => {
    const message = _n('%d file', '%d files', 3);
    assert.deepEqual([message.text, message.plural, message.count], ['%d file', '%d files', 3]);
  });

  it('when calling _nx(), then it also holds the context', () => {
    const message = _nx('%d comment', '%d comments', 0, 'blog');
    assert.deepEqual([message.text, message.plural, message.count, message.context], ['%d comment', '%d comments', 0, 'blog']);
  });
});

describe('given invalid calls', () => {
  it('when the text is empty or not a string, then it fails naming the function', () => {
    assert.throws(() => __(''), { message: '__(): the text must be a non-empty string' });
    assert.throws(() => __(5 as never), { message: '__(): the text must be a non-empty string' });
    assert.throws(() => _x('Post', ''), { message: '_x(): the context must be a non-empty string' });
  });

  it('when the count is negative, fractional or not a number, then _n() fails', () => {
    for (const count of [-1, 1.5, Number.NaN, '3' as never]) {
      assert.throws(() => _n('%d file', '%d files', count), { message: '_n(): the count must be a non-negative integer' });
    }
  });
});

describe('given a message read as a string', () => {
  it('when it is converted or concatenated, then it throws because messages are resolved at runtime', () => {
    const message = __('Hi');
    const expected = { message: 'messages are resolved at runtime: pass the message itself as a child, title, state value, set() value or command description' };
    assert.throws(() => `${message}`, expected);
    assert.throws(() => String(message), expected);
    assert.throws(() => message + '!', expected);
  });
});

describe('given sprintf()', () => {
  it('when called with a message, then it returns a new message that carries the arguments', () => {
    const base = __('Hello, %s!');
    const filled = sprintf(base, 'world') as Message;
    assert.ok(filled instanceof Message);
    assert.deepEqual([filled.text, filled.args], ['Hello, %s!', ['world']]);
    assert.deepEqual(base.args, [], 'the original message is not modified');
  });

  it('when called with a plain string, then it formats it right away like PHP', () => {
    assert.equal(sprintf('Hello, %s! %d', 'world', 3), 'Hello, world! 3');
  });

  it('when used with _n(), then the count and the argument can both be given', () => {
    const message = sprintf(_n('%d file', '%d files', 3), 3) as Message;
    assert.deepEqual([message.plural, message.count, message.args], ['%d files', 3, [3]]);
  });

  it('when there are too few or too many arguments, then it fails and says how many the text uses', () => {
    assert.throws(() => sprintf(__('%s and %s'), 'one'), { message: 'sprintf(): "%s and %s" needs 2 arguments but 1 was given' });
    assert.throws(() => sprintf(__('%s'), 'a', 'b'), { message: 'sprintf(): "%s" needs 1 argument but 2 were given' });
  });

  it('when an argument is neither a string nor a number, then it fails', () => {
    assert.throws(() => sprintf(__('%s'), {} as never), { message: 'sprintf(): arguments must be strings or numbers' });
  });
});

describe('given placeholders', () => {
  it('when counting them, then sequential specifiers count one each and positional ones count the highest index', () => {
    assert.equal(placeholderCount('no placeholders'), 0);
    assert.equal(placeholderCount('%s and %d'), 2);
    assert.equal(placeholderCount('%2$s, %1$s!'), 2);
    assert.equal(placeholderCount('100%% sure'), 0);
  });
});
