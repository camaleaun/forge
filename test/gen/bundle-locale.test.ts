import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateAppHeader } from '../../src/gen/app-header.ts';
import { generateCmake } from '../../src/gen/cmake.ts';
import { generateCmakeLinux } from '../../src/gen/cmake-linux.ts';
import { generateMessagesCpp } from '../../src/gen/messages-cpp.ts';
import { generateProject, needsHttp, runtimeFilesFor } from '../../src/gen/index.ts';
import { helloI18nIr, helloI18nOptions } from './helpers.ts';

const ir = helloI18nIr();
const TEXT = '#forge-lang 1\nHello, world!\tOlá, "mundo"!\n';
const bundled = (extra = {}) => helloI18nOptions({ bundle: { tag: 'pt-BR', text: TEXT }, ...extra });
const http = (files: string[]) => files.filter((file) => file.startsWith('http'));

describe('given a project that bundles one language pack into the binary', () => {
  it('when every pack is bundled, then the HTTP library is not needed even with downloads on', () => {
    assert.equal(needsHttp(ir, bundled()), false);
    for (const target of ['macos', 'linux']) assert.deepEqual(http(runtimeFilesFor(bundled(), target, ir)), []);
  });
  it('when another pack is not bundled and downloads are on, then the HTTP library is needed', () => {
    const packs = [...helloI18nOptions().packs, { tag: 'fr', file: 'hello-0.1.0-fr.lang', sha256: 'ab'.repeat(32), size: 9 }];
    assert.equal(needsHttp(ir, bundled({ packs })), true);
    assert.equal(needsHttp(ir, bundled({ packs, download: false })), false);
  });
  it('when generating messages.cpp, then it carries the tag and the exact pack bytes (escaped) next to the pinned pack list', () => {
    const cpp = generateMessagesCpp(ir, bundled());
    assert.match(cpp, /const char\* const BUNDLED_LOCALE = "pt-BR";/);
    assert.match(cpp, /const char BUNDLED_PACK\[\] = "#forge-lang 1\\nHello, world!\\tOlá, \\"mundo\\"!\\n";/);
    assert.match(cpp, new RegExp(`const unsigned BUNDLED_PACK_SIZE = ${Buffer.byteLength(TEXT)};`));
    assert.match(cpp, /const PackDef PACKS\[\]/);
  });
  it('when nothing is bundled, then messages.cpp and forge_app.hpp are exactly as before', () => {
    assert.doesNotMatch(generateMessagesCpp(ir, helloI18nOptions()), /BUNDLED/);
    assert.doesNotMatch(generateAppHeader(ir, true, true), /FORGE_BUNDLED/);
  });
  it('when generating the project, then forge_app.hpp defines FORGE_BUNDLED and no HTTP, on both targets', () => {
    for (const target of ['macos', 'linux']) {
      const files = generateProject(ir, target, { i18n: bundled() });
      const header = files.get('forge_app.hpp') as string;
      assert.match(header, /#define FORGE_BUNDLED 1/);
      assert.doesNotMatch(header, /FORGE_HTTP/);
      assert.match(files.get('messages.cpp') as string, /BUNDLED_LOCALE = "pt-BR"/);
      assert.doesNotMatch(files.get('CMakeLists.txt') as string, /http_|soup|glib-networking/);
    }
  });
});

describe('given the FORGE_VARIANT CMake variable', () => {
  it('when generating for Linux, then the file name of every package gets the -<tag> suffix and the package name stays', () => {
    const cmake = generateCmakeLinux(ir);
    assert.match(cmake, /set\(FORGE_VARIANT "" CACHE STRING/);
    assert.match(cmake, /if\(FORGE_VARIANT\)\n {2}set\(FORGE_VARIANT_SUFFIX "-\$\{FORGE_VARIANT\}"\)\nendif\(\)/);
    assert.match(cmake, /set\(CPACK_PACKAGE_FILE_NAME "hello-0\.1\.0-linux-\$\{FORGE_ARCH\}\$\{FORGE_VARIANT_SUFFIX\}"\)/);
    assert.match(cmake, /set\(CPACK_PACKAGE_NAME "hello"\)/);
    assert.match(cmake, /set\(CPACK_DEBIAN_FILE_NAME "\$\{CPACK_PACKAGE_FILE_NAME\}\.deb"\)/);
  });
  it('when generating for macOS, then the variable exists and names the CPack file only when set', () => {
    const cmake = generateCmake(ir);
    assert.match(cmake, /set\(FORGE_VARIANT "" CACHE STRING/);
    assert.match(cmake, /if\(FORGE_VARIANT\)\n {2}set\(CPACK_PACKAGE_FILE_NAME "hello-0\.1\.0-Darwin-\$\{FORGE_VARIANT\}"\)\nendif\(\)/);
    assert.match(cmake, /set\(CPACK_PACKAGE_NAME "hello"\)/);
  });
});
