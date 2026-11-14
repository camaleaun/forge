import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { renderDmgBackground } from '../dmg/background.ts';
import { buildIcns } from '../icon/icns.ts';
import { buildGlassIcon } from '../icon/glass.ts';
import type { GlassLayers } from '../icon/glass.ts';
import { encodePng } from '../dmg/png.ts';
import { rasterizeSvg } from '../icon/raster.ts';
import { parseSvg } from '../icon/svg.ts';
import { withBuiltinMessages } from '../i18n/builtin.ts';
import type { Ir } from '../ir/types.ts';
import { appIdFor } from '../project/app-id.ts';
import { generateActionsCpp } from './actions-cpp.ts';
import { generateAppHeader } from './app-header.ts';
import { generateCliRouter } from './cli-router.ts';
import { generateCmake } from './cmake.ts';
import { generateCmakeLinux } from './cmake-linux.ts';
import { generateDmgSetupScript } from './dmg.ts';
import type { I18nGenOptions } from './i18n-options.ts';
import { LINUX_ICON_SIZES, generateDesktopEntry, generateMetainfo } from './linux-desktop.ts';
import type { PackageMeta } from './linux-desktop.ts';
import { assertNoSteps } from './layout.ts';
import { generateLinuxUi } from './linux.ts';
import { generateMacosUi } from './macos.ts';
import { generateMessagesCpp } from './messages-cpp.ts';
import { generateSnapcraft } from './snap.ts';

export const TARGETS = ['macos', 'linux'];
// Hand-written runtime sources that the build copies next to the generated files.
export const RUNTIME_FILES = ['main.cpp', 'cli_surface.hpp'];
// The i18n runtime is copied only for apps that have language packs.
export const I18N_RUNTIME_FILES = ['i18n_loader.hpp', 'i18n.hpp', 'i18n.cpp', 'i18n_common.cpp', 'i18n_platform.hpp', 'i18n_macos.mm'];
// Linux shares the loader core and swaps the platform adapter (i18n_platform.hpp is its interface).
export const I18N_RUNTIME_FILES_LINUX = ['i18n_loader.hpp', 'i18n.hpp', 'i18n.cpp', 'i18n_common.cpp', 'i18n_platform.hpp', 'i18n_linux.cpp'];
export function hasPacks(i18n: I18nGenOptions | undefined): i18n is I18nGenOptions {
  return i18n !== undefined && i18n.packs.length > 0;
}
export function runtimeFilesFor(i18n?: I18nGenOptions, target = 'macos'): string[] {
  if (!hasPacks(i18n)) return RUNTIME_FILES;
  return [...RUNTIME_FILES, ...(target === 'linux' ? I18N_RUNTIME_FILES_LINUX : I18N_RUNTIME_FILES)];
}
export const RUNTIME_DIR = new URL('./runtime/', import.meta.url).pathname;

export type ProjectFiles = Map<string, string | Uint8Array>;

function dmgBackground(scale: 1 | 2): Uint8Array {
  const { width, height, rgba } = renderDmgBackground({ scale });
  return encodePng(width, height, rgba);
}

// Returns relative path -> file content for the generated (not runtime) files.
export function generateProject(source: Ir, target: string, options: { iconSvg?: string; glassLayers?: GlassLayers; i18n?: I18nGenOptions; appId?: string; meta?: PackageMeta } = {}): ProjectFiles {
  const i18nMode = hasPacks(options.i18n);
  // forge's own help texts become messages in i18n mode so the packs can translate them.
  const ir = i18nMode ? withBuiltinMessages(source) : source;
  if (!TARGETS.includes(target)) throw new Error(`unsupported target "${target}" (supported: ${TARGETS.join(', ')})`);
  assertNoSteps(ir.root, target);
  if (ir.app.icon && options.iconSvg === undefined) throw new Error('the app has an icon but no icon.svg source was given');
  const i18n = hasPacks(options.i18n) ? options.i18n : undefined;
  if (target === 'linux') return generateLinuxProject(ir, i18n, options.appId ?? appIdFor(ir.app, 'linux'), options.iconSvg, options.meta ?? {});
  const files: ProjectFiles = new Map([
    ['forge_app.hpp', generateAppHeader(ir, !!i18n)],
    ['actions.cpp', generateActionsCpp(ir, !!i18n)],
    ['cli_router.cpp', generateCliRouter(ir, !!i18n)],
    ['ui_macos.mm', generateMacosUi(ir, i18n)],
    ['CMakeLists.txt', generateCmake(ir, !!i18n, { glassIcon: options.glassLayers !== undefined })],
    ['dmg/setup.applescript', generateDmgSetupScript(ir)],
    ['dmg/background.png', dmgBackground(1)],
    ['dmg/background@2x.png', dmgBackground(2)],
  ]);
  if (i18n) files.set('messages.cpp', generateMessagesCpp(ir, i18n));
  if (options.glassLayers) for (const [name, content] of buildGlassIcon(options.glassLayers)) files.set(name, content);
  if (ir.app.icon && options.iconSvg !== undefined) files.set(ir.app.icon, buildIcns(options.iconSvg));
  return files;
}

function generateLinuxProject(ir: Ir, i18n: I18nGenOptions | undefined, appId: string, iconSvg: string | undefined, meta: PackageMeta): ProjectFiles {
  const files: ProjectFiles = new Map([
    ['forge_app.hpp', generateAppHeader(ir, !!i18n)],
    ['actions.cpp', generateActionsCpp(ir, !!i18n)],
    ['cli_router.cpp', generateCliRouter(ir, !!i18n)],
    ['ui_linux.cpp', generateLinuxUi(ir, appId, i18n)],
    ['CMakeLists.txt', generateCmakeLinux(ir, !!i18n, { appId, icon: !!ir.app.icon, meta })],
    [`${appId}.desktop`, generateDesktopEntry(ir, appId, meta)],
    [`${appId}.metainfo.xml`, generateMetainfo(ir, appId, meta)],
    ['snap/snapcraft.yaml', generateSnapcraft(ir, appId, meta, i18n)],
  ]);
  if (i18n) files.set('messages.cpp', generateMessagesCpp(ir, i18n));
  if (ir.app.icon && iconSvg !== undefined) {
    const doc = parseSvg(iconSvg);
    for (const size of LINUX_ICON_SIZES) {
      files.set(`icons/hicolor/${size}x${size}/apps/${appId}.png`, encodePng(size, size, rasterizeSvg(doc, size)));
    }
    files.set(`icons/hicolor/scalable/apps/${appId}.svg`, iconSvg);
  }
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
