import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { renderDmgBackground } from '../dmg/background.ts';
import { buildIcns } from '../icon/icns.ts';
import { encodePng } from '../dmg/png.ts';
import type { Ir } from '../ir/types.ts';
import { generateActionsCpp } from './actions-cpp.ts';
import { generateAppHeader } from './app-header.ts';
import { generateCliRouter } from './cli-router.ts';
import { generateCmake } from './cmake.ts';
import { generateDmgSetupScript } from './dmg.ts';
import { generateMacosUi } from './macos.ts';

export const TARGETS = ['macos'];
// Hand-written runtime sources that the build copies next to the generated files.
export const RUNTIME_FILES = ['main.cpp', 'cli_surface.hpp'];
export const RUNTIME_DIR = new URL('./runtime/', import.meta.url).pathname;

export type ProjectFiles = Map<string, string | Uint8Array>;

function dmgBackground(scale: 1 | 2): Uint8Array {
  const { width, height, rgba } = renderDmgBackground({ scale });
  return encodePng(width, height, rgba);
}

// Returns relative path -> file content for the generated (not runtime) files.
export function generateProject(ir: Ir, target: string, options: { iconSvg?: string } = {}): ProjectFiles {
  if (target !== 'macos') throw new Error(`unsupported target "${target}" (supported: ${TARGETS.join(', ')})`);
  if (ir.app.icon && options.iconSvg === undefined) throw new Error('the app has an icon but no icon.svg source was given');
  const files: ProjectFiles = new Map([
    ['forge_app.hpp', generateAppHeader(ir)],
    ['actions.cpp', generateActionsCpp(ir)],
    ['cli_router.cpp', generateCliRouter(ir)],
    ['ui_macos.mm', generateMacosUi(ir)],
    ['CMakeLists.txt', generateCmake(ir)],
    ['dmg/setup.applescript', generateDmgSetupScript(ir)],
    ['dmg/background.png', dmgBackground(1)],
    ['dmg/background@2x.png', dmgBackground(2)],
  ]);
  if (ir.app.icon && options.iconSvg !== undefined) files.set(ir.app.icon, buildIcns(options.iconSvg));
  return files;
}

// Writes the files under `dir`, creating nested folders.
export function writeProjectFiles(files: ProjectFiles, dir: string): void {
  for (const [name, content] of files) {
    const path = join(dir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
}
