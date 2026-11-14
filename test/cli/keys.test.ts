import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleKey } from '../../src/cli/keys.ts';

function recorder() {
  const calls: string[] = [];
  return {
    calls,
    actions: {
      open: () => calls.push('open'),
      showQr: () => calls.push('qr'),
      showHelp: () => calls.push('help'),
      stop: () => calls.push('stop'),
    },
  };
}

describe('given the keys of the running preview', () => {
  for (const [key, expected] of [['o', 'open'], ['O', 'open'], ['q', 'qr'], ['h', 'help'], ['?', 'help'], ['\u0003', 'stop']] as const) {
    it(`when ${JSON.stringify(key)} is pressed, then the "${expected}" action runs`, () => {
      const { calls, actions } = recorder();
      assert.equal(handleKey(key, actions), true);
      assert.deepEqual(calls, [expected]);
    });
  }

  it('when another key is pressed, then nothing runs and it is reported as unhandled', () => {
    const { calls, actions } = recorder();
    assert.equal(handleKey('x', actions), false);
    assert.deepEqual(calls, []);
  });
});
