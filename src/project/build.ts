import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { GLASS_FOLDER, loadGlassFolder } from '../icon/folder.ts';
import type { GlassLayers } from '../icon/glass.ts';
import { parseSvg } from '../icon/svg.ts';
import { buildIr } from '../ir/build.ts';
import type { Ir } from '../ir/types.ts';
import type { PackageInfo } from '../i18n/project.ts';
import { loadProject } from './load.ts';
import { applyStyles, parseStyles } from './styles.ts';

// Loads the app in `dir` for `target` (default: the web preview; see src/ir/targets.ts) and returns its IR (with resolved styles) or every error found.
export const ICON_FILE = 'AppIcon.icns';

function isLink(path: string): boolean {
  try { return lstatSync(path).isSymbolicLink(); } catch { return false; }
}

export async function buildProjectIr(dir: string, target?: string): Promise<{ ir?: Ir; errors: string[]; iconSvg?: string; glassLayers?: GlassLayers; pkg?: PackageInfo }> {
  let project;
  try {
    project = await loadProject(dir);
  } catch (error) {
    return { errors: [(error as Error).message] };
  }
  // An languages/ folder switches on translation of literal JSX text and of the window title.
  const translateLiterals = existsSync(join(resolve(dir), 'languages'));
  const built = buildIr({ file: 'App.tsx', app: project.app, App: project.App, commands: project.commands, translateLiterals, target });
  const css = parseStyles(project.cssFiles.map((file) => ({ file, source: readFileSync(file, 'utf8') })));
  const errors = [...built.errors, ...css.errors];
  if (!built.ir) return { errors };
  errors.push(...applyStyles(built.ir, css.rules, 'App.css'));

  // An optional icon.svg next to App.tsx becomes the app icon (AppIcon.icns).
  const iconPath = join(resolve(dir), 'icon.svg');
  let iconSvg: string | undefined;
  if (existsSync(iconPath)) {
    iconSvg = readFileSync(iconPath, 'utf8');
    try {
      parseSvg(iconSvg, { file: 'icon.svg' });
      built.ir.app.icon = ICON_FILE;
    } catch (error) {
      errors.push((error as Error).message);
    }
  }
  // An optional icon/ folder (background.svg + foreground-N.svg) becomes a Liquid Glass icon (AppIcon.icon).
  let glassLayers: GlassLayers | undefined;
  const glassDir = join(resolve(dir), GLASS_FOLDER);
  if (existsSync(glassDir) || isLink(glassDir)) {
    if (isLink(glassDir)) {
      errors.push(`${GLASS_FOLDER}: a symbolic link is not allowed here (${GLASS_FOLDER}/ must be a real folder inside the project)`);
    } else {
      const folder = loadGlassFolder(glassDir);
      errors.push(...folder.errors);
      glassLayers = folder.layers;
    }
  }
  const pkg: PackageInfo = { name: project.app.name, version: project.app.version };
  try {
    const raw = JSON.parse(readFileSync(join(resolve(dir), 'package.json'), 'utf8'));
    if (raw.repository !== undefined) pkg.repository = raw.repository;
    if (raw.forge !== undefined) pkg.forge = raw.forge;
  } catch {
    // loadProject already read this file; only the optional fields are lost.
  }
  return errors.length > 0 ? { errors } : { ir: built.ir, errors, iconSvg, glassLayers, pkg };
}
