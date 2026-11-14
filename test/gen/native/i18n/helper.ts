import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from '../../helpers.ts';

export const hasClang = spawnSync('clang++', ['--version']).status === 0;
export const RUNTIME = join(ROOT, 'src/gen/runtime');
export const DRIVER = join(ROOT, 'test/gen/native/i18n/driver.cpp');
export const VECTORS = new URL('../../../fixtures/i18n/vectors.json', import.meta.url).pathname;

export const CXXFLAGS = ['-std=c++20', '-Wall', '-Wextra', '-Werror'];

export interface Driver {
  dir: string;
  run: (...args: string[]) => string;
  file: (name: string, content: string | Buffer) => string;
  dispose: () => void;
}

// Compiles the driver against the runtime once per test file.
export function buildDriver(): Driver {
  const dir = mkdtempSync(join(tmpdir(), 'forge-i18n-'));
  const binary = join(dir, 'driver');
  const build = spawnSync('clang++', [...CXXFLAGS, '-I', RUNTIME, DRIVER, join(RUNTIME, 'i18n.cpp'), '-o', binary], { encoding: 'utf8' });
  if (build.status !== 0) throw new Error(`driver build failed:\n${build.stderr}`);
  return {
    dir,
    run: (...args) => {
      const result = spawnSync(binary, args, { encoding: 'utf8', maxBuffer: 1 << 26 });
      if (result.status !== 0) throw new Error(`driver exited ${result.status}: ${result.stderr}`);
      return result.stdout;
    },
    file: (name, content) => {
      const path = join(dir, name);
      writeFileSync(path, content);
      return path;
    },
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  };
}
