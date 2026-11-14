import { copyFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { RUNTIME_DIR, RUNTIME_FILES, generateProject, writeProjectFiles } from '../gen/index.ts';
import type { ProjectFiles } from '../gen/index.ts';
import { buildProjectIr } from '../project/build.ts';

export type BuildOptions = { project: string; target: string; out: string };

// Returns the process exit code; messages go to stderr.
export async function build(options: BuildOptions): Promise<number> {
  const { ir, errors, iconSvg } = await buildProjectIr(resolve(options.project));
  if (!ir) {
    for (const error of errors) console.error(`error: ${error}`);
    return 1;
  }
  let files: ProjectFiles;
  try {
    files = generateProject(ir, options.target, { iconSvg });
  } catch (error) {
    console.error(`error: ${(error as Error).message}`);
    return 1;
  }
  mkdirSync(options.out, { recursive: true });
  writeProjectFiles(files, options.out);
  for (const name of RUNTIME_FILES) copyFileSync(join(RUNTIME_DIR, name), join(options.out, name));
  return 0;
}
