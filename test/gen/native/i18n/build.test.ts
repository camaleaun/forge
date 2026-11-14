import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { CXXFLAGS, DRIVER, RUNTIME, hasClang } from './helper.ts';

let dir = '';
const cpp = join(RUNTIME, 'i18n.cpp');

describe('given the i18n runtime as it is compiled into generated apps', { skip: !hasClang && 'clang++ not installed' }, () => {
  before(() => { dir = mkdtempSync(join(tmpdir(), 'forge-i18n-build-')); });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it('when built with -fno-exceptions -fno-rtti -Os and pedantic warnings, then it compiles clean', () => {
    const result = spawnSync('clang++', [...CXXFLAGS, '-pedantic', '-fno-exceptions', '-fno-rtti', '-Os', '-I', RUNTIME, '-c', cpp, '-o', join(dir, 'i18n-os.o')], { encoding: 'utf8' });
    assert.equal(result.stderr, '');
    assert.equal(result.status, 0);
  });

  it('when the -Os object is measured, then its size is reported', () => {
    const size = statSync(join(dir, 'i18n-os.o')).size;
    console.log(`i18n.cpp -Os object size: ${size} bytes`);
    assert.ok(size > 0 && size < 100_000, `unexpectedly large object: ${size}`);
  });

  it('when the runtime is included, then it pulls in no iostream, regex or stream headers (the libc++ <string> header includes <locale> transitively; no locale code is used)', () => {
    const result = spawnSync('clang++', ['-std=c++20', '-E', '-I', RUNTIME, cpp], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    assert.equal(result.status, 0);
    for (const header of ['iostream', 'regex', 'sstream', 'fstream'])
      assert.ok(!result.stdout.includes(`/c++/v1/${header}"`), header);
  });

  it('when the driver runs under ASan and UBSan on hostile input, then no sanitizer error is reported', () => {
    const binary = join(dir, 'driver-san');
    const build = spawnSync('clang++', [...CXXFLAGS, '-g', '-fsanitize=address,undefined', '-fno-sanitize-recover=all', '-I', RUNTIME, DRIVER, cpp, '-o', binary], { encoding: 'utf8' });
    assert.equal(build.status, 0, build.stderr);
    const runs: string[][] = [
      ['plural', 'n % 0', '1'], ['plural', '('.repeat(5000) + 'n', '1'], ['plural', 'n ? 1 : '.repeat(500) + '0', '3'],
      ['plural', 'n % n', '-9223372036854775808'], ['plural', 'n == 2', '9223372036854775807'],
      ['format', '%999999999d%n%1$', 'a'], ['format', '%99999999999999999999$s%', ''],
      ['normalize', '@.@_-_', ''], ['pick', ',,_,-', 'pt-BR,,'],
    ];
    for (const args of runs) {
      const result = spawnSync(binary, args.filter((a, i) => i < 2 || a !== '' || args[0] !== 'normalize'), { encoding: 'utf8' });
      assert.equal(result.status, 0, `${args[0]}: ${result.stderr}`);
    }
  });
});
