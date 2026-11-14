import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// libc++ (macOS) pulls <algorithm> in through other headers, libstdc++ (Linux) does not: every portable
// C++ source that uses an algorithm must include its header itself, or it only builds on the Mac.
const root = new URL('../../../', import.meta.url).pathname;
const dirs = ['src/gen/runtime', 'test/gen/fixtures', 'test/fixtures/native'];
const needs: [RegExp, string][] = [
  [/\bstd::(sort|find|find_if|remove|remove_if|reverse|min|max|count|any_of|all_of|unique|lower_bound|upper_bound)\s*\(/, '<algorithm>'],
  [/\bstd::(unique_ptr|shared_ptr|make_unique|make_shared)\b/, '<memory>'],
  [/\bstd::(function)\b/, '<functional>'],
];

describe('given the portable C++ sources and fixtures', () => {
  for (const dir of dirs) {
    for (const name of readdirSync(join(root, dir)).filter((n) => /\.(cpp|hpp)$/.test(n))) {
      it(`when ${dir}/${name} uses a standard facility, then it includes the header that defines it`, () => {
        const text = readFileSync(join(root, dir, name), 'utf8');
        const code = text.replace(/^\s*\/\/.*$/gm, '');
        for (const [use, header] of needs) {
          if (use.test(code)) assert.ok(text.includes(`#include ${header}`), `${name} uses ${use} but does not include ${header}`);
        }
      });
    }
  }
});
