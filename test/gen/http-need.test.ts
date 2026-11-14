import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateAppHeader } from '../../src/gen/app-header.ts';
import { generateCmake } from '../../src/gen/cmake.ts';
import { generateCmakeLinux } from '../../src/gen/cmake-linux.ts';
import { generateProject, needsHttp, runtimeFilesFor, RUNTIME_FILES } from '../../src/gen/index.ts';
import { helloI18nIr, helloI18nOptions } from './helpers.ts';

const http = (files: string[]) => files.filter((file) => file.startsWith('http'));
const ir = helloI18nIr();

describe('given the decision whether an app needs the HTTP library', () => {
  it('when there are packs and downloads are on, then it is needed', () => {
    assert.equal(needsHttp(ir, helloI18nOptions()), true);
  });
  it('when downloads are off, then it is not needed', () => {
    assert.equal(needsHttp(ir, helloI18nOptions({ download: false })), false);
  });
  it('when there are no packs or no i18n, then it is not needed', () => {
    assert.equal(needsHttp(ir, helloI18nOptions({ packs: [] })), false);
    assert.equal(needsHttp(ir, undefined), false);
  });
  it('when the app source marks a remote feature, then it is needed even without packs', () => {
    assert.equal(needsHttp({ ...ir, uses: { remote: true } }, undefined), true);
    assert.equal(needsHttp({ ...ir, uses: { remote: true } }, helloI18nOptions({ download: false })), true);
  });
  for (const target of ['macos', 'linux']) {
    it(`when listing runtime files for ${target}, then http.* follows the decision`, () => {
      assert.deepEqual(http(runtimeFilesFor(helloI18nOptions({ download: false }), target, ir)), []);
      assert.equal(http(runtimeFilesFor(helloI18nOptions(), target, ir)).length, 4);
      assert.ok(runtimeFilesFor(helloI18nOptions({ download: false }), target, ir).includes('i18n_common.cpp'));
      assert.deepEqual(runtimeFilesFor(undefined, target, { ...ir, uses: { remote: true } }), [...RUNTIME_FILES, ...http(runtimeFilesFor(helloI18nOptions(), target, ir))]);
    });
  }
  it('when downloads are off, then the CMake lists have no http sources and Linux has no libsoup or glib-networking', () => {
    assert.doesNotMatch(generateCmake(ir, true, { http: false }), /http_/);
    const linux = generateCmakeLinux(ir, true, { http: false });
    assert.doesNotMatch(linux, /http_|soup|glib-networking/i);
    assert.match(linux, /i18n_common\.cpp/);
  });
  it('when http is on without i18n, then the CMake lists carry only the http sources', () => {
    assert.match(generateCmake(ir, false, { http: true }), /http_common\.cpp\n {2}http_macos\.mm/);
    const linux = generateCmakeLinux(ir, false, { http: true });
    assert.match(linux, /http_common\.cpp\n {2}http_linux\.cpp/);
    assert.match(linux, /libsoup-3\.0/);
    assert.doesNotMatch(linux, /i18n_/);
  });
  it('when generating the project, then forge_app.hpp defines FORGE_HTTP exactly when http is needed', () => {
    const on = generateProject(ir, 'macos', { i18n: helloI18nOptions() }).get('forge_app.hpp') as string;
    const off = generateProject(ir, 'linux', { i18n: helloI18nOptions({ download: false }) }).get('forge_app.hpp') as string;
    assert.match(on, /#define FORGE_HTTP 1/);
    assert.doesNotMatch(off, /FORGE_HTTP/);
    assert.doesNotMatch(generateAppHeader(ir), /FORGE_HTTP/);
  });
});
