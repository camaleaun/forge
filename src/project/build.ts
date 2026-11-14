import { readFileSync } from 'node:fs';
import { buildIr } from '../ir/build.ts';
import type { Ir } from '../ir/types.ts';
import { loadProject } from './load.ts';
import { applyStyles, parseStyles } from './styles.ts';

// Loads the app in `dir` and returns its IR (with resolved styles) or every error found.
export async function buildProjectIr(dir: string): Promise<{ ir?: Ir; errors: string[] }> {
  let project;
  try {
    project = await loadProject(dir);
  } catch (error) {
    return { errors: [(error as Error).message] };
  }
  const built = buildIr({ file: 'App.tsx', app: project.app, App: project.App, commands: project.commands });
  const css = parseStyles(project.cssFiles.map((file) => ({ file, source: readFileSync(file, 'utf8') })));
  const errors = [...built.errors, ...css.errors];
  if (!built.ir) return { errors };
  errors.push(...applyStyles(built.ir, css.rules, 'App.css'));
  return errors.length > 0 ? { errors } : { ir: built.ir, errors };
}
