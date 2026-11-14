import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseSvg } from '../icon/svg.ts';
import { buildIr } from '../ir/build.ts';
import type { Ir } from '../ir/types.ts';
import { loadProject } from './load.ts';
import { applyStyles, parseStyles } from './styles.ts';

// Loads the app in `dir` and returns its IR (with resolved styles) or every error found.
export const ICON_FILE = 'AppIcon.icns';

export async function buildProjectIr(dir: string): Promise<{ ir?: Ir; errors: string[]; iconSvg?: string }> {
  let project;
  try {
    project = await loadProject(dir);
  } catch (error) {
    return { errors: [(error as Error).message] };
  }
  // An i18n/ folder switches on translation of literal JSX text and of the window title.
  const translateLiterals = existsSync(join(resolve(dir), 'i18n'));
  const built = buildIr({ file: 'App.tsx', app: project.app, App: project.App, commands: project.commands, translateLiterals });
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
  return errors.length > 0 ? { errors } : { ir: built.ir, errors, iconSvg };
}
