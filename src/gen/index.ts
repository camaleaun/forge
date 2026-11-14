import type { Ir } from '../ir/types.ts';
import { generateActionsCpp } from './actions-cpp.ts';
import { generateAppHeader } from './app-header.ts';
import { generateCliRouter } from './cli-router.ts';
import { generateCmake } from './cmake.ts';
import { generateMacosUi } from './macos.ts';

export const TARGETS = ['macos'];
// Hand-written runtime sources that the build copies next to the generated files.
export const RUNTIME_FILES = ['main.cpp', 'cli_surface.hpp'];
export const RUNTIME_DIR = new URL('./runtime/', import.meta.url).pathname;

// Returns relative path -> file content for the generated (not runtime) files.
export function generateProject(ir: Ir, target: string): Map<string, string> {
  if (target !== 'macos') throw new Error(`unsupported target "${target}" (supported: ${TARGETS.join(', ')})`);
  return new Map([
    ['forge_app.hpp', generateAppHeader(ir)],
    ['actions.cpp', generateActionsCpp(ir)],
    ['cli_router.cpp', generateCliRouter(ir)],
    ['ui_macos.mm', generateMacosUi(ir)],
    ['CMakeLists.txt', generateCmake(ir)],
  ]);
}
