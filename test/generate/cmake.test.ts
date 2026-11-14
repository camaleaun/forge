import { describe, it } from 'node:test';
import { generateCmake } from '../../src/generate/cmake.ts';
import { hello } from '../helpers/fixtures.ts';

const golden = (name: string) => new URL(`../golden/hello/${name}`, import.meta.url).pathname;

describe('given the hello spec', () => {
  it('when generating CMakeLists.txt, then it matches golden/hello/CMakeLists.txt', (t) => {
    t.assert.fileSnapshot(generateCmake(hello()), golden('CMakeLists.txt'), { serializers: [(value) => value as string] });
  });
});
