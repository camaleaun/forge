import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateCmakeLinux } from '../../src/gen/cmake-linux.ts';
import { helloIr, serializers } from './helpers.ts';

const GOLDEN = new URL('../golden/ir-hello-linux/', import.meta.url).pathname;

describe('given the hello IR', () => {
  const cmake = generateCmakeLinux(helloIr());

  it('when generating CMake for Linux, then it matches golden/ir-hello-linux/CMakeLists.txt', (t) => {
    t.assert.fileSnapshot(cmake, GOLDEN + 'CMakeLists.txt', { serializers });
  });
  it('when generating, then GTK 4 comes from pkg-config and libsoup is not linked', () => {
    assert.ok(cmake.includes('pkg_check_modules(GTK4 REQUIRED IMPORTED_TARGET gtk4)'));
    assert.ok(!cmake.includes('libsoup'));
    assert.ok(!cmake.includes('i18n'));
  });
  it('when generating, then the sources are the runtime plus the generated Linux UI', () => {
    for (const file of ['main.cpp', 'actions.cpp', 'cli_router.cpp', 'ui_linux.cpp']) assert.ok(cmake.includes(`  ${file}`), file);
    assert.ok(!cmake.includes('ui_macos'));
  });
  it('when generating, then size flags and dead-code removal keep the binary tiny and stripped', () => {
    for (const flag of ['-Os', '-fno-exceptions', '-fno-rtti', '-ffunction-sections', '-fdata-sections', '-fvisibility=hidden']) {
      assert.ok(cmake.includes(flag), flag);
    }
    assert.ok(cmake.includes('-Wl,--gc-sections,--as-needed'));
    assert.ok(cmake.includes('-s'));
  });
  it('when generating, then project() gets the numeric version', () => {
    const ir = helloIr();
    ir.app.version = '0.2.0-rc.1';
    assert.ok(generateCmakeLinux(ir).includes('project(hello VERSION 0.2.0 LANGUAGES CXX)'));
  });
});

describe('given an app with language packs', () => {
  const cmake = generateCmakeLinux(helloIr(), true);
  it('when generating, then libsoup 3 is required and the loader sources are compiled', () => {
    assert.ok(cmake.includes('pkg_check_modules(SOUP3 REQUIRED IMPORTED_TARGET libsoup-3.0)'));
    for (const file of ['messages.cpp', 'i18n.cpp', 'i18n_common.cpp', 'i18n_linux.cpp']) assert.ok(cmake.includes(`  ${file}`), file);
    assert.ok(cmake.includes('PkgConfig::SOUP3'));
  });
});
