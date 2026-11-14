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

describe('given an IR with an app icon', () => {
  const ir = helloIr();
  ir.app.icon = 'AppIcon.icns';
  const cmake = generateCmake(ir);

  it('when generating, then AppIcon.icns is compiled into the bundle Resources and named in Info.plist', () => {
    assert.ok(cmake.includes('  AppIcon.icns)'), 'listed as a source of the executable');
    assert.ok(cmake.includes('set_source_files_properties(AppIcon.icns PROPERTIES MACOSX_PACKAGE_LOCATION Resources)'));
    assert.ok(cmake.includes('MACOSX_BUNDLE_ICON_FILE AppIcon'));
  });

  it('when the IR has no icon, then none of that appears', () => {
    const without = generateCmake(helloIr());
    assert.ok(!without.includes('AppIcon') && !without.includes('MACOSX_PACKAGE_LOCATION'));
  });
});

describe('given a Liquid Glass icon (AppIcon.icon next to the sources)', () => {
  const glass = generateCmake(helloIr(), false, { glassIcon: true });

  it('when generating, then actool is looked up and its version checked at configure time', () => {
    assert.ok(glass.includes('execute_process(COMMAND xcrun --find actool'));
    assert.ok(glass.includes('COMMAND xcrun actool --version'));
    assert.ok(glass.includes('short-bundle-version</key>'));
    assert.ok(glass.includes('CMAKE_MATCH_1 GREATER_EQUAL 26'));
  });

  it('when actool 26 is there, then a custom command compiles AppIcon.icon and the results go to Resources', () => {
    assert.ok(glass.includes('add_custom_command('));
    assert.ok(glass.includes('--app-icon AppIcon'));
    assert.ok(glass.includes('--minimum-deployment-target 26.0'));
    assert.ok(glass.includes('--include-all-app-icons'));
    assert.ok(glass.includes('--output-partial-info-plist'));
    assert.ok(glass.includes('Assets.car'));
    assert.ok(glass.includes('MACOSX_PACKAGE_LOCATION Resources'));
  });

  it('when actool 26 is there, then Info.plist also names CFBundleIconName and CFBundleIconFile', () => {
    assert.ok(glass.includes('CFBundleIconName'));
    assert.ok(glass.includes('MACOSX_BUNDLE_INFO_PLIST'));
    assert.ok(glass.includes('MACOSX_BUNDLE_ICON_FILE AppIcon'));
  });

  it('when the app has no icon.svg either, then without actool 26 the bundle has no icon', () => {
    assert.ok(!glass.includes('AppIcon.icns PROPERTIES'));
    assert.ok(glass.includes('if(forge_glass_icon)'));
  });

  it('when the app has icon.svg too, then without actool 26 it falls back to the classic AppIcon.icns', () => {
    const ir = helloIr();
    ir.app.icon = 'AppIcon.icns';
    const both = generateCmake(ir, false, { glassIcon: true });
    assert.ok(both.includes('set_source_files_properties(AppIcon.icns PROPERTIES MACOSX_PACKAGE_LOCATION Resources)'));
    assert.ok(both.includes('else()'));
  });

  it('when glassIcon is off or not given, then none of it appears', () => {
    for (const cmake of [generateCmake(helloIr()), generateCmake(helloIr(), false, { glassIcon: false })]) {
      assert.ok(!cmake.includes('actool') && !cmake.includes('CFBundleIconName'));
    }
  });
});
