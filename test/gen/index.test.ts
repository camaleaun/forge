import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateProject, writeProjectFiles, runtimeFilesFor, RUNTIME_DIR, RUNTIME_FILES, TARGETS } from '../../src/gen/index.ts';
import { helloIr } from './helpers.ts';

describe('given the hello IR and the macos target', () => {
  it('when generating the project, then the sources and the DMG files are returned', () => {
    const files = generateProject(helloIr(), 'macos');
    assert.deepEqual([...files.keys()].sort(), [
      'CMakeLists.txt', 'actions.cpp', 'cli_router.cpp', 'dmg/background.png', 'dmg/background@2x.png', 'dmg/setup.applescript',
      'forge_app.hpp', 'ui_macos.mm',
    ]);
    for (const [name, content] of files) {
      if (typeof content === 'string') assert.ok(/^(\/\/|#|--)/.test(content), `${name} starts with a generated-file comment`);
    }
  });

  it('when generating the project, then the DMG background images are PNGs of 1x and 2x size', () => {
    const files = generateProject(helloIr(), 'macos');
    const size = (name: string) => {
      const png = files.get(name) as Uint8Array;
      assert.deepEqual([...png.slice(1, 4)], [0x50, 0x4e, 0x47], `${name} is a PNG`);
      const view = new DataView(png.buffer, png.byteOffset);
      return [view.getUint32(16), view.getUint32(20)];
    };
    assert.deepEqual(size('dmg/background.png'), [600, 400]);
    assert.deepEqual(size('dmg/background@2x.png'), [1200, 800]);
  });
});

describe('given an unsupported target', () => {
  it('when generating, then it throws naming the supported targets', () => {
    assert.throws(() => generateProject(helloIr(), 'beos'), { message: 'unsupported target "beos" (supported: macos, linux)' });
  });
});

describe('given the runtime listing', () => {
  it('when inspected, then main.cpp and cli_surface.hpp exist in the absolute runtime dir', () => {
    assert.deepEqual([...RUNTIME_FILES].sort(), ['cli_surface.hpp', 'main.cpp']);
    for (const file of RUNTIME_FILES) assert.ok(existsSync(join(RUNTIME_DIR, file)), file);
  });
});

describe('given generated files in nested folders', () => {
  it('when writing them, then the folders are created and binary files are written byte for byte', () => {
    const dir = mkdtempSync(join(tmpdir(), 'forge-write-'));
    try {
      writeProjectFiles(new Map<string, string | Uint8Array>([['a.txt', 'text'], ['sub/dir/b.bin', new Uint8Array([0, 255, 7])]]), dir);
      assert.deepEqual(readdirSync(dir).sort(), ['a.txt', 'sub']);
      assert.deepEqual([...readFileSync(join(dir, 'sub/dir/b.bin'))], [0, 255, 7]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" rx="2" fill="#f60"/></svg>';

describe('given an IR with an app icon', () => {
  it('when generating with the SVG source, then AppIcon.icns is included and is a real icns file', () => {
    const ir = helloIr();
    ir.app.icon = 'AppIcon.icns';
    const icns = generateProject(ir, 'macos', { iconSvg: ICON_SVG }).get('AppIcon.icns') as Uint8Array;
    assert.equal(String.fromCharCode(...icns.slice(0, 4)), 'icns');
    assert.equal(new DataView(icns.buffer, icns.byteOffset).getUint32(4), icns.length);
  });

  it('when the SVG source is missing, then generating fails with a clear message', () => {
    const ir = helloIr();
    ir.app.icon = 'AppIcon.icns';
    assert.throws(() => generateProject(ir, 'macos'), { message: 'the app has an icon but no icon.svg source was given' });
  });

  it('when the IR has no icon, then no AppIcon.icns is generated', () => {
    assert.ok(!generateProject(helloIr(), 'macos').has('AppIcon.icns'));
  });
});

describe('given the hello IR and the linux target', () => {
  it('when generating the project, then the Linux sources and the .desktop are returned, with no macOS or DMG files', () => {
    const files = generateProject(helloIr(), 'linux');
    assert.deepEqual([...files.keys()].sort(), [
      'CMakeLists.txt', 'actions.cpp', 'cli_router.cpp', 'forge_app.hpp', 'local.forge.hello.desktop', 'ui_linux.cpp',
    ]);
  });
  it('when the app name has a dash, then the .desktop is named after the dash-free id', () => {
    const ir = helloIr();
    ir.app.name = 'my-app';
    assert.ok(generateProject(ir, 'linux').has('local.forge.my_app.desktop'));
  });
  it('when an explicit appId is given, then the .desktop uses it', () => {
    assert.ok(generateProject(helloIr(), 'linux', { appId: 'org.example.Hello' }).has('org.example.Hello.desktop'));
  });
  it('when listing targets, then macos and linux are supported', () => {
    assert.deepEqual(TARGETS, ['macos', 'linux']);
  });
});

describe('given the runtime file lists per target', () => {
  it('when there are no packs, then both targets copy the same plain runtime', () => {
    assert.deepEqual(runtimeFilesFor(undefined, 'linux'), RUNTIME_FILES);
    assert.deepEqual(runtimeFilesFor(undefined), RUNTIME_FILES);
  });
  it('when there are packs, then linux gets the shared loader plus the linux adapter and no i18n_macos.mm', () => {
    const i18n = { appId: 'x.y', packs: [{ tag: 'pt-BR', file: 'a.lang', sha256: '0'.repeat(64), size: 1 }], baseUrl: 'https://x/', download: true, menu: true };
    const linux = runtimeFilesFor(i18n, 'linux');
    assert.deepEqual(linux.slice(RUNTIME_FILES.length).sort(), [
      'i18n.cpp', 'i18n.hpp', 'i18n_common.cpp', 'i18n_linux.cpp', 'i18n_loader.hpp', 'i18n_platform.hpp',
    ]);
    assert.ok(!linux.includes('i18n_macos.mm'));
    assert.ok(runtimeFilesFor(i18n, 'macos').includes('i18n_macos.mm'));
  });
});

describe('given glass icon layers', () => {
  const layer = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#08f"/></svg>';
  const glassLayers = { background: layer, foreground: [layer] };

  it('when generating, then AppIcon.icon/ is part of the files and CMake compiles it', () => {
    const files = generateProject(helloIr(), 'macos', { glassLayers });
    assert.ok(files.has('AppIcon.icon/icon.json'));
    assert.ok(files.has('AppIcon.icon/Assets/background.svg'));
    assert.ok((files.get('CMakeLists.txt') as string).includes('actool'));
  });

  it('when there are no glass layers, then no AppIcon.icon/ and no actool in CMake', () => {
    const files = generateProject(helloIr(), 'macos');
    assert.ok(![...files.keys()].some((name) => name.startsWith('AppIcon.icon')));
    assert.ok(!(files.get('CMakeLists.txt') as string).includes('actool'));
  });
});
