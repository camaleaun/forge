import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformJsx } from '../tsx/transform.ts';

const API_URL = new URL('../app/api.ts', import.meta.url).href;
const JSX_RUNTIME_URL = new URL('../ir/runtime.ts', import.meta.url).href;

let registered = false;
let loadId = 0;
let importedCss: string[] = [];

// Starts a fresh project load: CSS files are re-evaluated (new query) and collected again.
export function beginLoad(): number {
  loadId += 1;
  importedCss = [];
  return loadId;
}

export function cssImportedByLastLoad(): string[] {
  return [...importedCss];
}

const filePath = (url: string) => fileURLToPath(url.split('?')[0]);

export function registerForgeHooks(): void {
  if (registered) return;
  registered = true;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === 'forge') return { url: API_URL, shortCircuit: true };
      if (specifier === 'forge/jsx') return { url: JSX_RUNTIME_URL, shortCircuit: true };
      if (specifier.endsWith('.css')) {
        const resolved = nextResolve(specifier, context);
        return { ...resolved, url: `${resolved.url}?t=${loadId}`, shortCircuit: true };
      }
      return nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      const path = url.startsWith('file:') ? filePath(url) : '';
      if (path.endsWith('.tsx')) {
        const source = transformJsx(readFileSync(path, 'utf8'), basename(path));
        return { format: 'module-typescript', source, shortCircuit: true };
      }
      if (path.endsWith('.css')) {
        importedCss.push(path);
        return { format: 'module', source: `export default ${JSON.stringify(path)};`, shortCircuit: true };
      }
      return nextLoad(url, context);
    },
  });
}
