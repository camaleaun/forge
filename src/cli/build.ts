import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { traceAction } from '../actions/trace.ts';
import type { Effect } from '../actions/trace.ts';
import { generateProject } from '../generate/index.ts';
import { loadProject } from '../spec/load.ts';
import { validateSpec } from '../spec/validate.ts';

const RUNTIME_DIR = new URL('../../runtime/', import.meta.url).pathname;
const RUNTIME_FILES = ['main.cpp', 'cli_surface.hpp'];

export type BuildOptions = { project: string; target: string; out: string };

// Returns the process exit code; messages go to stderr.
export async function build(options: BuildOptions): Promise<number> {
  const { spec, actions } = await loadProject(resolve(options.project));
  const errors = validateSpec(spec, Object.keys(actions));
  if (errors.length > 0) {
    for (const error of errors) console.error(`error: ${error}`);
    return 1;
  }
  const effects: Record<string, Effect[]> = {};
  try {
    for (const [name, action] of Object.entries(actions)) effects[name] = traceAction(name, action, spec);
  } catch (error) {
    console.error(`error: ${(error as Error).message}`);
    return 1;
  }
  const files = generateProject(spec, effects, options.target);
  mkdirSync(options.out, { recursive: true });
  for (const [name, content] of files) writeFileSync(join(options.out, name), content);
  for (const name of RUNTIME_FILES) copyFileSync(join(RUNTIME_DIR, name), join(options.out, name));
  return 0;
}
