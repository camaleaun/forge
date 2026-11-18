import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildManifest } from '../../src/release/manifest.ts';

const options = { version: '0.1.0', repo: 'camaleaun/forge-hello-world', tag: 'v0.1.0' };

describe('given language variants of the packages (<app>-<version>-<platform>-<tag>.<ext>)', () => {
  const rc = { version: '0.4.0-rc.3', repo: 'o/r', tag: 'v0.4.0-rc.3' };
  const base = 'https://github.com/o/r/releases/download/v0.4.0-rc.3/';
  const asset = (name: string, sha256 = 'aa', size = 1) => ({ name, sha256, size });
  const defaults = [
    asset('hello-forge-0.4.0-rc.3-darwin-arm64.zip'),
    asset('hello-forge-0.4.0-rc.3-darwin-arm64.dmg'),
    asset('hello-forge-0.4.0-rc.3-linux-x86_64.tar.gz'),
    asset('hello-forge-0.4.0-rc.3-linux-x86_64.deb'),
  ];

  it('when variant files sit next to the default ones, then platforms and packages list only the defaults and variants lists the rest', () => {
    const manifest = buildManifest(rc, [
      ...defaults,
      asset('hello-forge-0.4.0-rc.3-darwin-arm64-pt-BR.zip', 'v1', 11),
      asset('hello-forge-0.4.0-rc.3-darwin-arm64-pt-BR.dmg', 'v2', 12),
      asset('hello-forge-0.4.0-rc.3-linux-x86_64-pt-BR.tar.gz', 'v3', 13),
      asset('hello-forge-0.4.0-rc.3-linux-x86_64-pt-BR.deb', 'v4', 14),
      asset('hello-forge-0.4.0-rc.3-linux-x86_64-pt-BR.rpm', 'v5', 15),
      asset('hello-forge-0.4.0-rc.3-linux-x86_64-pt-BR.snap', 'v6', 16),
      asset('hello-forge-0.4.0-rc.3-linux-x86_64-pt-BR.AppImage', 'v7', 17),
      asset('hello-forge-0.4.0-rc.3-linux-x86_64-fr.deb', 'v8', 18),
    ]);
    assert.deepEqual(Object.keys(manifest.platforms).sort(), ['darwin-arm64', 'linux-x86_64']);
    assert.deepEqual(Object.keys(manifest.packages ?? {}).sort(), ['darwin-arm64', 'linux-x86_64']);
    assert.deepEqual(manifest.packages?.['linux-x86_64'], { deb: { url: `${base}hello-forge-0.4.0-rc.3-linux-x86_64.deb`, sha256: 'aa', size: 1 } });
    assert.deepEqual(manifest.variants, {
      'pt-BR': {
        'darwin-arm64': {
          zip: { url: `${base}hello-forge-0.4.0-rc.3-darwin-arm64-pt-BR.zip`, sha256: 'v1', size: 11 },
          dmg: { url: `${base}hello-forge-0.4.0-rc.3-darwin-arm64-pt-BR.dmg`, sha256: 'v2', size: 12 },
        },
        'linux-x86_64': {
          'tar.gz': { url: `${base}hello-forge-0.4.0-rc.3-linux-x86_64-pt-BR.tar.gz`, sha256: 'v3', size: 13 },
          deb: { url: `${base}hello-forge-0.4.0-rc.3-linux-x86_64-pt-BR.deb`, sha256: 'v4', size: 14 },
          rpm: { url: `${base}hello-forge-0.4.0-rc.3-linux-x86_64-pt-BR.rpm`, sha256: 'v5', size: 15 },
          snap: { url: `${base}hello-forge-0.4.0-rc.3-linux-x86_64-pt-BR.snap`, sha256: 'v6', size: 16 },
          appimage: { url: `${base}hello-forge-0.4.0-rc.3-linux-x86_64-pt-BR.AppImage`, sha256: 'v7', size: 17 },
        },
      },
      fr: { 'linux-x86_64': { deb: { url: `${base}hello-forge-0.4.0-rc.3-linux-x86_64-fr.deb`, sha256: 'v8', size: 18 } } },
    });
  });

  it('when there are no variant files, then there is no variants key and the key order is unchanged', () => {
    const manifest = buildManifest(rc, defaults);
    assert.equal('variants' in manifest, false);
    assert.deepEqual(Object.keys(manifest), ['version', 'platforms', 'packages']);
  });

  it('when the tag has a region or a script (en-GB, zh-Hant-TW) or is a bare language (fr), then it is recognised', () => {
    const manifest = buildManifest(rc, [
      asset('app-0.4.0-rc.3-linux-arm64-en-GB.deb'),
      asset('app-0.4.0-rc.3-linux-arm64-zh-Hant-TW.deb'),
      asset('app-0.4.0-rc.3-darwin-arm64-fr.zip'),
    ]);
    assert.deepEqual(Object.keys(manifest.variants ?? {}).sort(), ['en-GB', 'fr', 'zh-Hant-TW']);
  });

  it('when the version has no prerelease, then the platform is not mistaken for part of the version', () => {
    const manifest = buildManifest(options, [asset('hello-0.1.0-linux-x86_64-fr.zip'), asset('hello-0.1.0-linux-x86_64.zip')]);
    assert.deepEqual(Object.keys(manifest.platforms), ['linux-x86_64']);
    assert.deepEqual(Object.keys(manifest.variants?.fr ?? {}), ['linux-x86_64']);
  });

  it('when the macOS CPack dmg of a variant has no platform, then it is ignored like the default one', () => {
    const manifest = buildManifest(rc, [asset('hello-0.4.0-rc.3-Darwin-pt-BR.dmg')]);
    assert.equal('variants' in manifest, false);
  });

  it('when a variant file is for another version, then it fails naming the file and both versions', () => {
    assert.throws(
      () => buildManifest(rc, [asset('hello-0.4.0-rc.2-darwin-arm64-pt-BR.zip')]),
      { message: 'asset "hello-0.4.0-rc.2-darwin-arm64-pt-BR.zip": version 0.4.0-rc.2 does not match release version 0.4.0-rc.3' },
    );
  });

  it('when two files claim the same variant, platform and kind, then it fails naming both', () => {
    assert.throws(
      () => buildManifest(rc, [asset('a-0.4.0-rc.3-linux-x86_64-pt-BR.deb'), asset('b-0.4.0-rc.3-linux-x86_64-pt-BR.deb')]),
      { message: 'asset "b-0.4.0-rc.3-linux-x86_64-pt-BR.deb": pt-BR linux-x86_64 deb is already provided by a-0.4.0-rc.3-linux-x86_64-pt-BR.deb' },
    );
  });
});
