import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { linuxArch, packageVersion } from '../../src/gen/linux-version.ts';

describe('given a release version', () => {
  it('when it has a prerelease, then deb and rpm get a tilde so the rc sorts before the final', () => {
    assert.equal(packageVersion('0.2.0-rc.1'), '0.2.0~rc.1');
    assert.equal(packageVersion('1.0.0-beta.2'), '1.0.0~beta.2');
  });
  it('when it is a final version, then it is unchanged', () => {
    assert.equal(packageVersion('0.2.0'), '0.2.0');
  });
});

describe('given a machine architecture', () => {
  it('when mapped to the file name arch, then aarch64 is arm64 and x86_64 stays', () => {
    assert.equal(linuxArch('aarch64'), 'arm64');
    assert.equal(linuxArch('arm64'), 'arm64');
    assert.equal(linuxArch('x86_64'), 'x86_64');
    assert.equal(linuxArch('amd64'), 'x86_64');
  });
});
