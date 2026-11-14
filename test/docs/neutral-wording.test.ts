import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('../../', import.meta.url).pathname;
// Built from pieces so this file does not contain the word itself.
const FORBIDDEN = new RegExp(['Word', 'Press'].join(''), 'i');
// The one place that may name the inspiration of the HTTP layer, in exactly one line.
const CREDIT_FILE = 'src/gen/runtime/http.hpp';
const CREDIT = '// API shape inspired by the HTTP helper of ' + ['Word', 'Press'].join('') + ' (WP_Http, wp_remote_*); original implementation, MIT.';
const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.astro']);
const TEXT = /\.(ts|tsx|md|mdx|json|txt|yml|yaml|astro|css|sh|cpp|hpp|mm|mjs|lang|svg|html)$/;

function walk(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, found);
    else if (TEXT.test(entry) && !path.endsWith('neutral-wording.test.ts') && relative(root, path) !== CREDIT_FILE) found.push(path);
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
  it('when reading the HTTP header, then it carries the credit line exactly once and nothing else names the inspiration', () => {
    const lines = readFileSync(join(root, CREDIT_FILE), 'utf8').split('\n');
    assert.equal(lines.filter((line) => line === CREDIT).length, 1);
    assert.equal(lines.filter((line) => FORBIDDEN.test(line)).length, 1);
  });
});
