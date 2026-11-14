import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildDriver, hasClang } from './helper.ts';
import type { Driver } from './helper.ts';

let d: Driver;
const sha = (content: string | Buffer, name = 'in.bin') => d.run('sha256', d.file(name, content)).trim();

describe('given the C++ SHA-256', { skip: !hasClang && 'clang++ not installed' }, () => {
  before(() => { d = buildDriver(); });
  after(() => d.dispose());

  it('when hashing the empty input, then it is the NIST empty vector', () => {
    assert.equal(sha(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
  it('when hashing "abc", then it is the NIST one-block vector', () => {
    assert.equal(sha('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('when hashing the 448-bit NIST message, then the padding spills into a second block', () => {
    assert.equal(sha('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });
  it('when hashing one million "a", then it is the NIST long-message vector', () => {
    assert.equal(sha('a'.repeat(1_000_000)), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  });
  it('when hashing inputs around the block boundaries, then they match node:crypto', () => {
    for (const size of [55, 56, 63, 64, 65, 119, 120, 128, 1000]) {
      const data = Buffer.from(Array.from({ length: size }, (_, i) => (i * 7 + 3) & 0xff));
      assert.equal(sha(data), createHash('sha256').update(data).digest('hex'), `size ${size}`);
    }
  });
  it('when hashing bytes with NUL and high bits (a UTF-8 pack), then they match node:crypto', () => {
    const data = Buffer.from('Olá, mundo\0\xff\n', 'latin1');
    assert.equal(sha(data), createHash('sha256').update(data).digest('hex'));
  });
});
