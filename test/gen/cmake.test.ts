import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateCmake } from '../../src/gen/cmake.ts';
import { golden, helloIr, serializers } from './helpers.ts';

describe('given the hello IR', () => {
  it('when generating CMake, then it matches golden/ir-hello/CMakeLists.txt', (t) => {
    t.assert.fileSnapshot(generateCmake(helloIr()), golden('CMakeLists.txt'), { serializers });
  });
});

describe('given version 0.1.0-rc.1', () => {
  const ir = helloIr();
  ir.app.version = '0.1.0-rc.1';
  const cmake = generateCmake(ir);

  it('when generating, then project() gets the numeric version only', () => {
    assert.ok(cmake.includes('project(hello VERSION 0.1.0 LANGUAGES CXX OBJCXX)'));
  });
  it('when generating, then the bundle and CPack keep the full version', () => {
    assert.ok(cmake.includes('MACOSX_BUNDLE_SHORT_VERSION_STRING "0.1.0-rc.1"'));
    assert.ok(cmake.includes('set(CPACK_PACKAGE_VERSION "0.1.0-rc.1")'));
  });
});
