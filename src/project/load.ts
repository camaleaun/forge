import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CommandDef } from '../ir/build.ts';
import { resetStates } from '../ir/state.ts';
import { beginLoad, cssImportedByLastLoad, registerForgeHooks } from './hooks.ts';

export type LoadedProject = {
  app: { name: string; version: string };
  App: () => unknown;
  commands: Record<string, CommandDef>;
  cssFiles: string[];
};

// Loads package.json and App.tsx. Throws an Error whose message is ready to print.
export async function loadProject(dir: string): Promise<LoadedProject> {
  const root = resolve(dir);
  let pkg: { name?: unknown; version?: unknown };
  try {
    pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  } catch (error) {
    throw new Error(`package.json: cannot read it (${(error as Error).message})`);
  }
  if (typeof pkg.name !== 'string' || typeof pkg.version !== 'string') {
    throw new Error('package.json: "name" and "version" must be strings');
  }
  const entry = join(root, 'App.tsx');
  if (!existsSync(entry)) throw new Error('App.tsx: the app entry file was not found');

  registerForgeHooks();
  resetStates();
  const id = beginLoad();
  const module = await import(`${pathToFileURL(entry).href}?t=${id}`);
  if (typeof module.default !== 'function') throw new Error('App.tsx: it must export a default function App()');
  return {
    app: { name: pkg.name, version: pkg.version },
    App: module.default,
    commands: module.commands ?? {},
    cssFiles: cssImportedByLastLoad(),
  };
}
