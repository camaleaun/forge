import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateCmake } from '../../src/generate/cmake.ts';
import { hello } from '../helpers/fixtures.ts';

const golden = (name: string) => new URL(`../golden/hello/${name}`, import.meta.url).pathname;

describe('given the hello spec', () => {
  it('when generating CMakeLists.txt, then it matches golden/hello/CMakeLists.txt', (t) => {
    t.assert.fileSnapshot(generateCmake(hello()), golden('CMakeLists.txt'), { serializers: [(value) => value as string] });
  });
});

describe('given a prerelease app version such as 0.1.0-rc.1', () => {
  it('when generating CMakeLists.txt, then project() gets the numeric part and the full version stays in the bundle and CPack', () => {
    const spec = hello();
    spec.app.version = '0.1.0-rc.1';
    const source = generateCmake(spec);
    assert.ok(source.includes('project(hello VERSION 0.1.0 LANGUAGES CXX OBJCXX)'), 'project() must use the numeric version');
    assert.ok(source.includes('MACOSX_BUNDLE_BUNDLE_VERSION "0.1.0-rc.1"'));
    assert.ok(source.includes('MACOSX_BUNDLE_SHORT_VERSION_STRING "0.1.0-rc.1"'));
    assert.ok(source.includes('set(CPACK_PACKAGE_VERSION "0.1.0-rc.1")'));
  });
});
