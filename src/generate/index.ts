import type { Effect } from '../actions/trace.ts';
import type { Spec } from '../spec/types.ts';
import { generateActionsCpp } from './actions-cpp.ts';
import { generateAppHeader } from './app-header.ts';
import { generateCliRouter } from './cli-router.ts';
import { generateCmake } from './cmake.ts';
import { generateMacosUi } from './macos.ts';

export const TARGETS = ['macos'];

// Returns relative path -> file content for the generated (not runtime) files.
export function generateProject(spec: Spec, effects: Record<string, Effect[]>, target: string): Map<string, string> {
  if (target !== 'macos') throw new Error(`unsupported target "${target}" (supported: ${TARGETS.join(', ')})`);
  return new Map([
    ['forge_app.hpp', generateAppHeader(spec, Object.keys(effects))],
    ['actions.cpp', generateActionsCpp(effects)],
    ['cli_router.cpp', generateCliRouter(spec)],
    ['ui_macos.mm', generateMacosUi(spec)],
    ['CMakeLists.txt', generateCmake(spec)],
  ]);
}
