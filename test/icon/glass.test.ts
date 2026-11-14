import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildGlassIcon, glassCompileArgs } from '../../src/icon/glass.ts';
import { svgOf } from './helpers.ts';

const goldenPath = (name: string): string => new URL(`../golden/icon/${name}`, import.meta.url).pathname;
const serializers = [(value: unknown) => value as string];
const bg = svgOf('<rect width="100" height="100" fill="#08f"/>');
const fg1 = svgOf('<circle cx="50" cy="50" r="30" fill="#fff"/>');
const fg2 = svgOf('<rect x="40" y="10" width="20" height="80" fill="#f00"/>');

describe('given a background and two foreground layers', () => {
  const files = buildGlassIcon({ background: bg, foreground: [fg1, fg2] });

  it('when built then the folder holds icon.json and the layer SVGs under AppIcon.icon/', () => {
    assert.deepEqual([...files.keys()].sort(), [
      'AppIcon.icon/Assets/background.svg',
      'AppIcon.icon/Assets/foreground-1.svg',
      'AppIcon.icon/Assets/foreground-2.svg',
      'AppIcon.icon/icon.json',
    ]);
  });

  it('when built then icon.json matches golden/icon/background-and-two-foregrounds.icon.json', (t) => {
    t.assert.fileSnapshot(files.get('AppIcon.icon/icon.json') as string, goldenPath('background-and-two-foregrounds.icon.json'), { serializers });
  });

  it('when built then the layer files are the given SVG sources, unchanged', () => {
    assert.equal(files.get('AppIcon.icon/Assets/background.svg'), bg);
    assert.equal(files.get('AppIcon.icon/Assets/foreground-2.svg'), fg2);
  });
});

describe('given only a foreground layer and a custom name', () => {
  it('when built then icon.json matches golden/icon/foreground-only.icon.json', (t) => {
    const files = buildGlassIcon({ foreground: [fg1] });
    t.assert.fileSnapshot(files.get('AppIcon.icon/icon.json') as string, goldenPath('foreground-only.icon.json'), { serializers });
  });

  it('when name is "Forge" then the folder is Forge.icon', () => {
    const files = buildGlassIcon({ foreground: [fg1] }, { name: 'Forge' });
    assert.deepEqual([...files.keys()].sort(), ['Forge.icon/Assets/foreground-1.svg', 'Forge.icon/icon.json']);
  });
});

describe('given invalid input', () => {
  it('when there is no foreground layer then it throws a clear message', () => {
    assert.throws(() => buildGlassIcon({ foreground: [] }), /at least one foreground layer/);
  });

  it('when a layer is not valid SVG then the error names the layer', () => {
    assert.throws(() => buildGlassIcon({ foreground: [fg1, '<svg'] }), /foreground-2\.svg/);
  });

  it('when the background is not valid SVG then the error names the background', () => {
    assert.throws(() => buildGlassIcon({ background: 'nope', foreground: [fg1] }), /background\.svg/);
  });

  it('when a layer is not square then it throws', () => {
    const wide = svgOf('<rect width="200" height="100"/>', '0 0 200 100');
    assert.throws(() => buildGlassIcon({ foreground: [wide] }), /foreground-1\.svg.*square/);
  });

  it('when the name has path characters then it throws', () => {
    assert.throws(() => buildGlassIcon({ foreground: [fg1] }, { name: '../x' }), /invalid icon name/);
  });
});

describe('given glassCompileArgs', () => {
  const args = glassCompileArgs({ iconPath: '/b/AppIcon.icon', outputDir: '/b/out', partialPlist: '/b/p.plist' });

  it('when called with defaults then it compiles the .icon for macosx 26 as AppIcon', () => {
    assert.deepEqual(args, [
      '--compile', '/b/out',
      '/b/AppIcon.icon',
      '--platform', 'macosx',
      '--minimum-deployment-target', '26.0',
      '--app-icon', 'AppIcon',
      '--output-partial-info-plist', '/b/p.plist',
      '--include-all-app-icons',
      '--enable-icon-stack-fallback-generation=disabled',
    ]);
  });

  it('when a name and deployment target are given then they are used', () => {
    const a = glassCompileArgs({ iconPath: '/x/Forge.icon', outputDir: '/o', partialPlist: '/p', name: 'Forge', minimumDeploymentTarget: '26.1' });
    assert.equal(a[a.indexOf('--app-icon') + 1], 'Forge');
    assert.equal(a[a.indexOf('--minimum-deployment-target') + 1], '26.1');
  });
});
