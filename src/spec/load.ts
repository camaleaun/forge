import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Action } from '../actions/trace.ts';
import type { Spec } from './types.ts';

export type Project = { spec: Spec; actions: Record<string, Action> };

export async function loadProject(dir: string): Promise<Project> {
  const spec = JSON.parse(readFileSync(join(dir, 'forge.json'), 'utf8')) as Spec;
  const module = await import(pathToFileURL(join(dir, 'actions.ts')).href);
  const actions = Object.fromEntries(
    Object.entries(module).filter((entry): entry is [string, Action] => typeof entry[1] === 'function'),
  );
  return { spec, actions };
}
