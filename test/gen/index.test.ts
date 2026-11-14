import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { generateProject, RUNTIME_DIR, RUNTIME_FILES } from '../../src/gen/index.ts';
import { helloIr } from './helpers.ts';

describe('given the hello IR and the macos target', () => {
  it('when generating the project, then the five generated files are returned', () => {
    const files = generateProject(helloIr(), 'macos');
    assert.deepEqual([...files.keys()].sort(), ['CMakeLists.txt', 'actions.cpp', 'cli_router.cpp', 'forge_app.hpp', 'ui_macos.mm']);
    for (const content of files.values()) assert.ok(content.startsWith('//') || content.startsWith('#'), 'generated header comment');
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
