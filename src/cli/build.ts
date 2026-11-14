import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { RUNTIME_DIR, RUNTIME_FILES, generateProject } from '../gen/index.ts';
import { buildProjectIr } from '../project/build.ts';

export type BuildOptions = { project: string; target: string; out: string };

// Returns the process exit code; messages go to stderr.
export async function build(options: BuildOptions): Promise<number> {
  const { ir, errors } = await buildProjectIr(resolve(options.project));
  if (!ir) {
    for (const error of errors) console.error(`error: ${error}`);
    return 1;
  }
  let files: Map<string, string>;
  try {
    files = generateProject(ir, options.target);
  } catch (error) {
    console.error(`error: ${(error as Error).message}`);
    return 1;
  }
  mkdirSync(options.out, { recursive: true });
  for (const [name, content] of files) writeFileSync(join(options.out, name), content);
  for (const name of RUNTIME_FILES) copyFileSync(join(RUNTIME_DIR, name), join(options.out, name));
  return 0;
}
