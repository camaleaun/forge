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
  it('when generating, then segments are aligned to 4 KB pages (aarch64 linkers default to 64 KB, which pads the binary by tens of KB)', () => {
    assert.ok(cmake.includes('-Wl,-z,max-page-size=4096'));
    assert.ok(cmake.includes('-z,common-page-size=4096'));
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
    for (const file of ['messages.cpp', 'i18n.cpp', 'i18n_common.cpp', 'i18n_linux.cpp', 'http_common.cpp', 'http_linux.cpp']) assert.ok(cmake.includes(`  ${file}`), file);
    assert.ok(cmake.includes('PkgConfig::SOUP3'));
  });
});

describe('given the install rules', () => {
  const options = { appId: 'local.forge.hello', icon: false };
  it('when generating, then the binary, .desktop and metainfo go to the standard directories', () => {
    const cmake = generateCmakeLinux(helloIr(), false, options);
    assert.ok(cmake.includes('include(GNUInstallDirs)'));
    assert.ok(cmake.includes('install(TARGETS hello RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR})'));
    assert.ok(cmake.includes('install(FILES local.forge.hello.desktop DESTINATION ${CMAKE_INSTALL_DATADIR}/applications)'));
    assert.ok(cmake.includes('install(FILES local.forge.hello.metainfo.xml DESTINATION ${CMAKE_INSTALL_DATADIR}/metainfo)'));
  });
  it('when the app has an icon, then the hicolor tree is installed; otherwise it is not', () => {
    assert.ok(generateCmakeLinux(helloIr(), false, { ...options, icon: true }).includes('install(DIRECTORY icons/hicolor DESTINATION ${CMAKE_INSTALL_DATADIR}/icons)'));
    assert.ok(!generateCmakeLinux(helloIr(), false, options).includes('install(DIRECTORY'));
  });
  it('when the app id comes from package.json, then the file names follow it', () => {
    assert.ok(generateCmakeLinux(helloIr(), false, { appId: 'org.example.Hello', icon: false }).includes('install(FILES org.example.Hello.desktop'));
  });
});

describe('given the CPack setup', () => {
  const ir = helloIr();
  ir.app.version = '0.2.0-rc.1';
  const meta = { description: 'Says hello', license: 'MIT', homepage: 'https://example.org/hello' };
  const cmake = generateCmakeLinux(ir, false, { appId: 'local.forge.hello', icon: true, meta });
  const withI18n = generateCmakeLinux(ir, true, { appId: 'local.forge.hello', icon: true, meta });

  it('when generating, then deb, rpm and tar.gz are built', () => {
    assert.ok(cmake.includes('set(CPACK_GENERATOR "DEB;RPM;TGZ")'));
    assert.ok(cmake.includes('include(CPack)'));
  });
  it('when the version has a prerelease, then the packages use a tilde so the rc sorts before the final', () => {
    assert.ok(cmake.includes('set(CPACK_PACKAGE_VERSION "0.2.0~rc.1")'));
  });
  it('when generating, then files are <app>-<version>-linux-<arch> with aarch64 called arm64 and the original version', () => {
    assert.ok(cmake.includes('set(CPACK_PACKAGE_FILE_NAME "hello-0.2.0-rc.1-linux-${FORGE_ARCH}")'));
    assert.ok(cmake.includes('set(FORGE_ARCH arm64)'));
    assert.ok(cmake.includes('set(FORGE_ARCH x86_64)'));
    assert.ok(cmake.includes('set(CPACK_DEBIAN_FILE_NAME "${CPACK_PACKAGE_FILE_NAME}.deb")'));
    assert.ok(cmake.includes('set(CPACK_RPM_FILE_NAME "${CPACK_PACKAGE_FILE_NAME}.rpm")'));
  });
  it('when generating, then everything installs under /usr', () => {
    assert.ok(cmake.includes('set(CPACK_PACKAGING_INSTALL_PREFIX "/usr")'));
    assert.ok(cmake.includes('set(CMAKE_INSTALL_PREFIX "/usr")'));
  });
  it('when generating, then deb finds its library dependencies and rpm requires gtk4', () => {
    assert.ok(cmake.includes('set(CPACK_DEBIAN_PACKAGE_SHLIBDEPS ON)'));
    assert.ok(cmake.includes('set(CPACK_RPM_PACKAGE_REQUIRES "gtk4")'));
    assert.ok(cmake.includes('set(CPACK_RPM_PACKAGE_AUTOREQ ON)'));
  });
  it('when the app has language packs, then glib-networking (TLS for libsoup) is a dependency of both', () => {
    assert.ok(withI18n.includes('set(CPACK_DEBIAN_PACKAGE_DEPENDS "glib-networking")'));
    assert.ok(withI18n.includes('set(CPACK_RPM_PACKAGE_REQUIRES "gtk4, glib-networking")'));
    assert.ok(!cmake.includes('glib-networking'));
  });
  it('when package metadata exists, then it fills the package fields', () => {
    assert.ok(cmake.includes('set(CPACK_PACKAGE_DESCRIPTION_SUMMARY "Says hello")'));
    assert.ok(cmake.includes('set(CPACK_PACKAGE_HOMEPAGE_URL "https://example.org/hello")'));
    assert.ok(cmake.includes('set(CPACK_RPM_PACKAGE_LICENSE "MIT")'));
  });
  it('when there is no metadata, then summary falls back to the name and the license to Proprietary', () => {
    const plain = generateCmakeLinux(helloIr(), false, { appId: 'local.forge.hello', icon: false });
    assert.ok(plain.includes('set(CPACK_PACKAGE_DESCRIPTION_SUMMARY "hello")'));
    assert.ok(plain.includes('set(CPACK_RPM_PACKAGE_LICENSE "Proprietary")'));
    assert.ok(!plain.includes('HOMEPAGE_URL'));
  });
  it('when the app has an icon, then rpm does not claim the shared icon and share directories', () => {
    assert.ok(cmake.includes('/usr/share/icons/hicolor/48x48/apps'));
    assert.ok(cmake.includes('CPACK_RPM_EXCLUDE_FROM_AUTO_FILELIST_ADDITION'));
  });
});
