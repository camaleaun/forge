import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildManifest } from '../../src/release/manifest.ts';

const options = { version: '0.1.0', repo: 'camaleaun/forge-hello-world', tag: 'v0.1.0' };

describe('given the portable zip of each platform', () => {
  it('when building the manifest, then each platform has the tag URL, sha256 and size', () => {
    const manifest = buildManifest(options, [
      { name: 'hello-0.1.0-darwin-arm64.zip', sha256: 'aa', size: 10 },
      { name: 'hello-0.1.0-linux-x64.zip', sha256: 'bb', size: 20 },
    ]);
    assert.deepEqual(manifest, {
      version: '0.1.0',
      platforms: {
        'darwin-arm64': {
          url: 'https://github.com/camaleaun/forge-hello-world/releases/download/v0.1.0/hello-0.1.0-darwin-arm64.zip',
          sha256: 'aa',
          size: 10,
        },
        'linux-x64': {
          url: 'https://github.com/camaleaun/forge-hello-world/releases/download/v0.1.0/hello-0.1.0-linux-x64.zip',
          sha256: 'bb',
          size: 20,
        },
      },
    });
  });
});

describe('given installers next to the zips', () => {
  it('when building the manifest, then only .zip assets are listed (the updater swaps the portable build)', () => {
    const manifest = buildManifest(options, [
      { name: 'hello-0.1.0-Darwin.dmg', sha256: 'cc', size: 5 },
      { name: 'hello-0.1.0-darwin-arm64.zip', sha256: 'aa', size: 10 },
    ]);
    assert.deepEqual(Object.keys(manifest.platforms), ['darwin-arm64']);
  });
});

describe('given a zip whose name does not follow <app>-<version>-<os>-<arch>.zip', () => {
  it('when building the manifest, then it fails naming the file', () => {
    assert.throws(
      () => buildManifest(options, [{ name: 'hello.zip', sha256: 'aa', size: 1 }]),
      { message: 'asset "hello.zip": name must be <app>-<version>-<os>-<arch>.zip' },
    );
  });
});

describe('given a zip built for another version than the tag', () => {
  it('when building the manifest, then it fails naming the file and both versions', () => {
    assert.throws(
      () => buildManifest(options, [{ name: 'hello-0.2.0-darwin-arm64.zip', sha256: 'aa', size: 1 }]),
      { message: 'asset "hello-0.2.0-darwin-arm64.zip": version 0.2.0 does not match release version 0.1.0' },
    );
  });
});

describe('given a prerelease version such as 0.1.0-rc.1', () => {
  it('when building the manifest, then the zip name carries the full version and the platform is still parsed', () => {
    const manifest = buildManifest(
      { version: '0.1.0-rc.1', repo: 'camaleaun/forge-hello-world', tag: 'v0.1.0-rc.1' },
      [{ name: 'hello-0.1.0-rc.1-darwin-arm64.zip', sha256: 'aa', size: 10 }],
    );
    assert.deepEqual(Object.keys(manifest.platforms), ['darwin-arm64']);
    assert.equal(
      manifest.platforms['darwin-arm64'].url,
      'https://github.com/camaleaun/forge-hello-world/releases/download/v0.1.0-rc.1/hello-0.1.0-rc.1-darwin-arm64.zip',
    );
  });
});

describe('given language packs next to the zips', () => {
  const zip = { name: 'hello-0.1.0-darwin-arm64.zip', sha256: 'aa', size: 10 };
  const pack = { name: 'hello-0.1.0-pt-BR.lang', sha256: 'dd', size: 200 };

  it('when building the manifest, then languages lists each pack with the tag URL, sha256 and size', () => {
    const manifest = buildManifest(options, [zip, pack, { name: 'hello-0.1.0-fr.lang', sha256: 'ee', size: 7 }]);
    assert.deepEqual(manifest.languages, {
      'pt-BR': {
        url: 'https://github.com/camaleaun/forge-hello-world/releases/download/v0.1.0/hello-0.1.0-pt-BR.lang',
        sha256: 'dd',
        size: 200,
      },
      fr: {
        url: 'https://github.com/camaleaun/forge-hello-world/releases/download/v0.1.0/hello-0.1.0-fr.lang',
        sha256: 'ee',
        size: 7,
      },
    });
    assert.deepEqual(Object.keys(manifest.platforms), ['darwin-arm64']);
  });

  it('when there is no .lang asset, then the manifest has no languages key at all', () => {
    const manifest = buildManifest(options, [zip, { name: 'notes.txt', sha256: 'ff', size: 1 }]);
    assert.equal('languages' in manifest, false);
    assert.equal(JSON.stringify(manifest), JSON.stringify({ version: '0.1.0', platforms: manifest.platforms }));
  });

  it('when the version is a prerelease, then the pt-BR tag is not confused with the version', () => {
    const manifest = buildManifest(
      { version: '0.1.0-rc.1', repo: 'o/r', tag: 'v0.1.0-rc.1' },
      [{ name: 'hello-0.1.0-rc.1-pt-BR.lang', sha256: 'dd', size: 9 }, { name: 'my-app-0.1.0-rc.1-zh-Hant-TW.lang', sha256: 'ee', size: 9 }],
    );
    assert.deepEqual(Object.keys(manifest.languages ?? {}), ['pt-BR', 'zh-Hant-TW']);
    assert.equal(manifest.languages?.['pt-BR'].url, 'https://github.com/o/r/releases/download/v0.1.0-rc.1/hello-0.1.0-rc.1-pt-BR.lang');
  });

  it('when a pack was built for another version, then it fails naming the file and both versions', () => {
    assert.throws(
      () => buildManifest(options, [{ name: 'hello-0.2.0-pt-BR.lang', sha256: 'dd', size: 1 }]),
      { message: 'asset "hello-0.2.0-pt-BR.lang": version 0.2.0 does not match release version 0.1.0' },
    );
  });

  it('when a .lang name does not follow <app>-<version>-<tag>.lang, then it fails naming the file', () => {
    assert.throws(
      () => buildManifest(options, [{ name: 'pt-BR.lang', sha256: 'dd', size: 1 }]),
      { message: 'asset "pt-BR.lang": name must be <app>-<version>-<tag>.lang' },
    );
  });

  it('when the same language appears twice, then it fails instead of picking one', () => {
    assert.throws(
      () => buildManifest(options, [pack, { name: 'other-0.1.0-pt-BR.lang', sha256: 'ee', size: 1 }]),
      { message: 'asset "other-0.1.0-pt-BR.lang": language pt-BR is already provided by hello-0.1.0-pt-BR.lang' },
    );
  });
});

describe('given the Linux portable tar.gz', () => {
  const rc = { version: '0.2.0-rc.1', repo: 'camaleaun/forge-hello-world', tag: 'v0.2.0-rc.1' };
  const base = 'https://github.com/camaleaun/forge-hello-world/releases/download/v0.2.0-rc.1/';

  it('when building the manifest, then linux-x86_64 and linux-arm64 platforms come from .tar.gz files', () => {
    const manifest = buildManifest(rc, [
      { name: 'hello-0.2.0-rc.1-linux-x86_64.tar.gz', sha256: 'aa', size: 10 },
      { name: 'hello-0.2.0-rc.1-linux-arm64.tar.gz', sha256: 'bb', size: 11 },
      { name: 'hello-0.2.0-rc.1-darwin-arm64.zip', sha256: 'cc', size: 12 },
    ]);
    assert.deepEqual(manifest.platforms['linux-x86_64'], { url: `${base}hello-0.2.0-rc.1-linux-x86_64.tar.gz`, sha256: 'aa', size: 10 });
    assert.deepEqual(manifest.platforms['linux-arm64'], { url: `${base}hello-0.2.0-rc.1-linux-arm64.tar.gz`, sha256: 'bb', size: 11 });
    assert.deepEqual(Object.keys(manifest.platforms).sort(), ['darwin-arm64', 'linux-arm64', 'linux-x86_64']);
  });
  it('when a zip and a tar.gz claim the same platform, then it fails naming both', () => {
    assert.throws(
      () => buildManifest(options, [
        { name: 'hello-0.1.0-linux-x64.zip', sha256: 'aa', size: 1 },
        { name: 'hello-0.1.0-linux-x64.tar.gz', sha256: 'bb', size: 1 },
      ]),
      { message: 'asset "hello-0.1.0-linux-x64.tar.gz": platform linux-x64 is already provided by hello-0.1.0-linux-x64.zip' },
    );
  });
  it('when a tar.gz name does not follow <app>-<version>-<os>-<arch>.tar.gz, then it fails naming the file', () => {
    assert.throws(
      () => buildManifest(options, [{ name: 'hello.tar.gz', sha256: 'aa', size: 1 }]),
      { message: 'asset "hello.tar.gz": name must be <app>-<version>-<os>-<arch>.tar.gz' },
    );
  });
  it('when the tar.gz is for another version, then it fails', () => {
    assert.throws(
      () => buildManifest(options, [{ name: 'hello-0.2.0-linux-x64.tar.gz', sha256: 'aa', size: 1 }]),
      { message: 'asset "hello-0.2.0-linux-x64.tar.gz": version 0.2.0 does not match release version 0.1.0' },
    );
  });
});

describe('given installable packages next to the portable files', () => {
  const rc = { version: '0.2.0-rc.1', repo: 'camaleaun/forge-hello-world', tag: 'v0.2.0-rc.1' };
  const base = 'https://github.com/camaleaun/forge-hello-world/releases/download/v0.2.0-rc.1/';
  const tarball = { name: 'hello-0.2.0-rc.1-linux-x86_64.tar.gz', sha256: 'aa', size: 10 };

  it('when there are deb, rpm, snap and AppImage files, then packages lists them per platform with url, sha256 and size', () => {
    const manifest = buildManifest(rc, [
      tarball,
      { name: 'hello-0.2.0-rc.1-linux-x86_64.deb', sha256: 'd1', size: 1 },
      { name: 'hello-0.2.0-rc.1-linux-x86_64.rpm', sha256: 'd2', size: 2 },
      { name: 'hello-0.2.0-rc.1-linux-x86_64.snap', sha256: 'd3', size: 3 },
      { name: 'hello-0.2.0-rc.1-linux-x86_64.AppImage', sha256: 'd4', size: 4 },
      { name: 'hello-0.2.0-rc.1-darwin-arm64.dmg', sha256: 'd5', size: 5 },
    ]);
    assert.deepEqual(manifest.packages, {
      'linux-x86_64': {
        deb: { url: `${base}hello-0.2.0-rc.1-linux-x86_64.deb`, sha256: 'd1', size: 1 },
        rpm: { url: `${base}hello-0.2.0-rc.1-linux-x86_64.rpm`, sha256: 'd2', size: 2 },
        snap: { url: `${base}hello-0.2.0-rc.1-linux-x86_64.snap`, sha256: 'd3', size: 3 },
        appimage: { url: `${base}hello-0.2.0-rc.1-linux-x86_64.AppImage`, sha256: 'd4', size: 4 },
      },
      'darwin-arm64': { dmg: { url: `${base}hello-0.2.0-rc.1-darwin-arm64.dmg`, sha256: 'd5', size: 5 } },
    });
  });
  it('when there are no packages, then the packages key is absent and a zip-only manifest is unchanged', () => {
    const manifest = buildManifest(options, [{ name: 'hello-0.1.0-darwin-arm64.zip', sha256: 'aa', size: 10 }]);
    assert.ok(!('packages' in manifest));
    assert.deepEqual(Object.keys(manifest), ['version', 'platforms']);
  });
  it('when an installer has no <os>-<arch> in its name (the macOS CPack name), then it is ignored', () => {
    const manifest = buildManifest(options, [{ name: 'hello-0.1.0-Darwin.dmg', sha256: 'cc', size: 5 }]);
    assert.ok(!('packages' in manifest));
  });
  it('when a package is for another version, then it fails naming the file', () => {
    assert.throws(
      () => buildManifest(rc, [{ name: 'hello-0.1.0-linux-x86_64.deb', sha256: 'aa', size: 1 }]),
      { message: 'asset "hello-0.1.0-linux-x86_64.deb": version 0.1.0 does not match release version 0.2.0-rc.1' },
    );
  });
  it('when two files of the same kind claim one platform, then it fails', () => {
    assert.throws(
      () => buildManifest(rc, [
        { name: 'hello-0.2.0-rc.1-linux-x86_64.deb', sha256: 'aa', size: 1 },
        { name: 'other-0.2.0-rc.1-linux-x86_64.deb', sha256: 'bb', size: 1 },
      ]),
      { message: 'asset "other-0.2.0-rc.1-linux-x86_64.deb": linux-x86_64 deb is already provided by hello-0.2.0-rc.1-linux-x86_64.deb' },
    );
  });
});
