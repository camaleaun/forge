import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateSnapcraft } from '../../src/gen/snap.ts';
import { generateProject } from '../../src/gen/index.ts';
import { helloIr, helloI18nIr, helloI18nOptions, serializers } from './helpers.ts';

const GOLDEN = new URL('../golden/ir-hello-linux/', import.meta.url).pathname;
const APP_ID = 'local.forge.hello';
const META = { description: 'Says hello', license: 'MIT' };

describe('given the hello IR', () => {
  const snap = generateSnapcraft(helloIr(), APP_ID, META);

  it('when generating, then it matches golden/ir-hello-linux/snapcraft.yaml', (t) => {
    t.assert.fileSnapshot(snap, GOLDEN + 'snapcraft.yaml', { serializers });
  });
  it('when generating, then it targets core24 with strict confinement and both architectures', () => {
    assert.match(snap, /^base: core24$/m);
    assert.match(snap, /^confinement: strict$/m);
    assert.match(snap, /^platforms:\n {2}amd64:\n {2}arm64:$/m);
  });
  it('when generating, then GTK comes from the gnome extension, not from the package', () => {
    assert.match(snap, /extensions: \[gnome\]/);
    assert.ok(snap.includes('libgtk-4-dev'));
    assert.ok(!snap.includes('stage-packages'));
  });
  it('when the download is off or there are no packs, then the network plug is absent', () => {
    assert.ok(!snap.includes('network'));
    assert.ok(!generateSnapcraft(helloI18nIr(), APP_ID, META, helloI18nOptions({ download: false })).includes('network'));
  });
  it('when the app has packs and downloads them, then it plugs network and builds with libsoup', () => {
    const withNetwork = generateSnapcraft(helloI18nIr(), APP_ID, META, helloI18nOptions());
    assert.match(withNetwork, /plugs: \[network\]/);
    assert.ok(withNetwork.includes('libsoup-3.0-dev'));
  });
  it('when the version is a final release, then the grade is stable', () => {
    assert.match(snap, /^grade: stable$/m);
  });
  it('when the version is a prerelease, then the grade is devel', () => {
    const ir = helloIr();
    ir.app.version = '0.2.0-rc.1';
    const rc = generateSnapcraft(ir, APP_ID, META);
    assert.match(rc, /^grade: devel$/m);
    assert.match(rc, /^version: "0.2.0-rc.1"$/m);
  });
  it('when the app has an icon, then the snap uses the 512 px PNG', () => {
    const ir = helloIr();
    ir.app.icon = 'AppIcon.icns';
    assert.match(generateSnapcraft(ir, APP_ID, META), /^icon: icons\/hicolor\/512x512\/apps\/local\.forge\.hello\.png$/m);
  });
});

describe('given the linux project', () => {
  it('when generating, then snap/snapcraft.yaml is part of it', () => {
    assert.ok(generateProject(helloIr(), 'linux').has('snap/snapcraft.yaml'));
  });
});
