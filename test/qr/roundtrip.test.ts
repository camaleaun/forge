import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { qrMatrix } from '../../src/qr/qr.ts';
import { decode } from './decoder.ts';

const samples: Record<string, string> = {
  'an ASCII LAN url': 'http://192.168.1.20:5170/?t=abc123',
  'a tiny text': 'hi',
  'a non-ASCII text': 'http://forge.local:5170/café/日本語?q=ça va',
  'a 14-byte text (v1 full)': 'abcdefghijklmn',
  'a 26-byte text (v2 full)': 'abcdefghijklmnopqrstuvwxyz',
  'a 62-byte text (v4 full, 2 blocks)': 'x'.repeat(62),
  'a 106-byte text (v6 full, 4 blocks)': 'http://10.0.0.1:5170/' + 'z'.repeat(85),
  'binary-looking bytes': '\u0000\u0001\u007fÿ',
};

for (const [name, text] of Object.entries(samples)) {
  describe(`given ${name}`, () => {
    it('when encoding and reading the data modules back (unmask, de-interleave, RS check) then the text is recovered', () => {
      assert.equal(decode(qrMatrix(text)), text);
    });
  });
}

describe('given the same text twice', () => {
  it('when encoding then the matrices are identical (deterministic)', () => {
    const t = 'http://192.168.1.20:5170/?t=abc123';
    assert.deepEqual(qrMatrix(t), qrMatrix(t));
  });
  it('when encoding different texts then the matrices differ', () => {
    assert.notDeepEqual(qrMatrix('http://a'), qrMatrix('http://b'));
  });
});
