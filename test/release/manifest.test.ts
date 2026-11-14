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
