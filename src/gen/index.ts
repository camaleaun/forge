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
import type { I18nGenOptions } from './i18n-options.ts';
import { generateMacosUi } from './macos.ts';
import { generateMessagesCpp } from './messages-cpp.ts';

export const TARGETS = ['macos'];
// Hand-written runtime sources that the build copies next to the generated files.
export const RUNTIME_FILES = ['main.cpp', 'cli_surface.hpp'];
// The i18n runtime is copied only for apps that have language packs.
export const I18N_RUNTIME_FILES = ['i18n_loader.hpp', 'i18n.hpp', 'i18n.cpp', 'i18n_macos.mm'];
export function hasPacks(i18n: I18nGenOptions | undefined): i18n is I18nGenOptions {
  return i18n !== undefined && i18n.packs.length > 0;
}
export function runtimeFilesFor(i18n?: I18nGenOptions): string[] {
  return hasPacks(i18n) ? [...RUNTIME_FILES, ...I18N_RUNTIME_FILES] : RUNTIME_FILES;
}
export const RUNTIME_DIR = new URL('./runtime/', import.meta.url).pathname;

export type ProjectFiles = Map<string, string | Uint8Array>;

function dmgBackground(scale: 1 | 2): Uint8Array {
  const { width, height, rgba } = renderDmgBackground({ scale });
  return encodePng(width, height, rgba);
}

// Returns relative path -> file content for the generated (not runtime) files.
export function generateProject(ir: Ir, target: string, options: { iconSvg?: string; i18n?: I18nGenOptions } = {}): ProjectFiles {
  if (target !== 'macos') throw new Error(`unsupported target "${target}" (supported: ${TARGETS.join(', ')})`);
  if (ir.app.icon && options.iconSvg === undefined) throw new Error('the app has an icon but no icon.svg source was given');
  const i18n = hasPacks(options.i18n) ? options.i18n : undefined;
  const files: ProjectFiles = new Map([
    ['forge_app.hpp', generateAppHeader(ir, !!i18n)],
    ['actions.cpp', generateActionsCpp(ir, !!i18n)],
    ['cli_router.cpp', generateCliRouter(ir, !!i18n)],
    ['ui_macos.mm', generateMacosUi(ir, i18n)],
    ['CMakeLists.txt', generateCmake(ir, !!i18n)],
    ['dmg/setup.applescript', generateDmgSetupScript(ir)],
    ['dmg/background.png', dmgBackground(1)],
    ['dmg/background@2x.png', dmgBackground(2)],
  ]);
  if (i18n) files.set('messages.cpp', generateMessagesCpp(ir, i18n));
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
