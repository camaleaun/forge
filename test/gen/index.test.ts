import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateProject, writeProjectFiles, RUNTIME_DIR, RUNTIME_FILES } from '../../src/gen/index.ts';
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
    assert.throws(() => generateProject(helloIr(), 'beos'), { message: 'unsupported target "beos" (supported: macos)' });
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
