import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateDesktopEntry, generateMetainfo } from '../../src/gen/linux-desktop.ts';
import { generateProject } from '../../src/gen/index.ts';
import { helloIr, serializers } from './helpers.ts';

const GOLDEN = new URL('../golden/ir-hello-linux/', import.meta.url).pathname;
const APP_ID = 'local.forge.hello';
const META = { description: 'Says hello & greets "you".', license: 'MIT', homepage: 'https://example.org/hello' };

describe('given the hello IR and its package metadata', () => {
  it('when generating the .desktop, then it matches golden/ir-hello-linux/local.forge.hello.desktop', (t) => {
    const ir = helloIr();
    ir.app.icon = 'AppIcon.icns';
    t.assert.fileSnapshot(generateDesktopEntry(ir, APP_ID, META), GOLDEN + 'local.forge.hello.desktop', { serializers });
  });
  it('when generating the metainfo, then it matches golden/ir-hello-linux/local.forge.hello.metainfo.xml', (t) => {
    t.assert.fileSnapshot(generateMetainfo(helloIr(), APP_ID, META), GOLDEN + 'local.forge.hello.metainfo.xml', { serializers });
  });
});

describe('given no package metadata and no icon', () => {
  const desktop = generateDesktopEntry(helloIr(), APP_ID);
  const metainfo = generateMetainfo(helloIr(), APP_ID);
  it('when generating the .desktop, then there is no Icon and no Comment', () => {
    assert.ok(!desktop.includes('Icon=') && !desktop.includes('Comment='));
    assert.ok(desktop.includes('Exec=hello\n'));
  });
  it('when generating the metainfo, then it falls back to the name and a proprietary license', () => {
    assert.ok(metainfo.includes('<project_license>LicenseRef-proprietary</project_license>'));
    assert.ok(metainfo.includes('<summary>hello</summary>'));
    assert.ok(!metainfo.includes('homepage'));
  });
});

describe('given characters that XML and the .desktop format treat specially', () => {
  it('when the description has & < > and a quote, then the metainfo escapes them', () => {
    const metainfo = generateMetainfo(helloIr(), APP_ID, { description: 'A <b> & "c"' });
    assert.ok(metainfo.includes('A &lt;b&gt; &amp; "c"'));
  });
  it('when the description has a newline, then the .desktop keeps one line', () => {
    assert.ok(generateDesktopEntry(helloIr(), APP_ID, { description: 'a\nb' }).includes('Comment=a b\n'));
  });
});

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" rx="2" fill="#f60"/></svg>';

describe('given an app with icon.svg on the linux target', () => {
  const ir = helloIr();
  ir.app.icon = 'AppIcon.icns';
  const files = generateProject(ir, 'linux', { iconSvg: SVG, meta: META });

  it('when generating, then hicolor holds one PNG per size named after the app id, plus the SVG', () => {
    const icons = [...files.keys()].filter((name) => name.startsWith('icons/')).sort();
    assert.deepEqual(icons, [
      'icons/hicolor/128x128/apps/local.forge.hello.png',
      'icons/hicolor/16x16/apps/local.forge.hello.png',
      'icons/hicolor/256x256/apps/local.forge.hello.png',
      'icons/hicolor/32x32/apps/local.forge.hello.png',
      'icons/hicolor/48x48/apps/local.forge.hello.png',
      'icons/hicolor/512x512/apps/local.forge.hello.png',
      'icons/hicolor/64x64/apps/local.forge.hello.png',
      'icons/hicolor/scalable/apps/local.forge.hello.svg',
    ]);
  });
  it('when generating, then each PNG has the size of its folder', () => {
    for (const size of [16, 32, 48, 64, 128, 256, 512]) {
      const png = files.get(`icons/hicolor/${size}x${size}/apps/local.forge.hello.png`) as Uint8Array;
      assert.deepEqual([...png.slice(1, 4)], [0x50, 0x4e, 0x47]);
      const view = new DataView(png.buffer, png.byteOffset);
      assert.deepEqual([view.getUint32(16), view.getUint32(20)], [size, size]);
    }
  });
  it('when generating, then the scalable icon is the source SVG and no .icns is emitted', () => {
    assert.equal(files.get('icons/hicolor/scalable/apps/local.forge.hello.svg'), SVG);
    assert.ok(!files.has('AppIcon.icns'));
  });
  it('when generating, then the metainfo is part of the project and the .desktop names the icon', () => {
    assert.ok(files.has('local.forge.hello.metainfo.xml'));
    assert.ok((files.get('local.forge.hello.desktop') as string).includes('Icon=local.forge.hello\n'));
  });
  it('when the IR has no icon, then no icons are generated', () => {
    assert.ok(![...generateProject(helloIr(), 'linux').keys()].some((name) => name.startsWith('icons/')));
  });
});
