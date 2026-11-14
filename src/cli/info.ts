import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const INFO_FIELDS = ['name', 'version'];

// Prints one field of the app's package.json. Returns the process exit code.
export function info(options: { project: string; field: string }): number {
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(readFileSync(join(resolve(options.project), 'package.json'), 'utf8'));
  } catch (error) {
    console.error(`error: cannot read package.json: ${(error as Error).message}`);
    return 1;
  }
  const value = pkg[options.field];
  if (typeof value !== 'string') {
    console.error(`error: package.json: missing "${options.field}"`);
    return 1;
  }
  console.log(value);
  return 0;
}
