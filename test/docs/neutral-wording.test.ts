import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('../../', import.meta.url).pathname;
// Built from pieces so this file does not contain the word itself.
const FORBIDDEN = new RegExp(['Word', 'Press'].join(''), 'i');
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.astro']);
const TEXT = /\.(ts|tsx|md|mdx|json|txt|yml|yaml|astro|css|sh|cpp|hpp|mm|mjs|lang|svg|html)$/;

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, found);
    else if (TEXT.test(entry) && !path.endsWith('neutral-wording.test.ts')) found.push(path);
  }
  return found;
}

describe('given the forge sources, tests and documentation', () => {
  it('when scanning them, then none names another product as the model for the translation functions', () => {
    const hits = walk(root)
      .filter((file) => FORBIDDEN.test(readFileSync(file, 'utf8')))
      .map((file) => relative(root, file));
    assert.deepEqual(hits, [], 'describe the functions neutrally (gettext-style) instead of naming another product');
  });
});
