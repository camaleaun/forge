import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('../../', import.meta.url).pathname;
const fixture = join(root, 'test/fixtures/hello-app');

function forge(...args: string[]) {
  return spawnSync(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', join(root, 'src/cli/forge.ts'), ...args], { encoding: 'utf8' });
}

// A copy of the hello app (messages: "Hello, forge" and "Greet" once languages/ exists) with the given i18n files.
function withApp(files: Record<string, string> | undefined, run: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'forge-i18n-cli-'));
  try {
    cpSync(fixture, dir, { recursive: true });
    if (files) {
      mkdirSync(join(dir, 'languages'));
      for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, 'languages', name), text);
    }
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('given an app with translatable phrases', () => {
  it('when running forge i18n extract, then languages/template.lang lists every phrase with an empty translation', () => {
    withApp({ 'pt-BR.lang': 'Greet\tCumprimentar\n' }, (dir) => {
      const result = forge('i18n', 'extract', '--project', dir);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(readFileSync(join(dir, 'languages', 'template.lang'), 'utf8'), 'Greet\t\nHello, forge\t\n');
      assert.match(result.stdout, /languages\/template\.lang: 2 phrases/);
    });
  });

  it('when languages/ does not exist yet, then extract creates it (the phrases are translatable once the folder exists)', () => {
    withApp(undefined, (dir) => {
      const result = forge('i18n', 'extract', '--project', dir);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(readFileSync(join(dir, 'languages', 'template.lang'), 'utf8'), 'Greet\t\nHello, forge\t\n');
    });
  });

  it('when running extract twice, then the file is byte-identical and template.lang is not read as a language', () => {
    withApp({}, (dir) => {
      forge('i18n', 'extract', '--project', dir);
      const first = readFileSync(join(dir, 'languages', 'template.lang'));
      assert.equal(forge('i18n', 'extract', '--project', dir).status, 0);
      assert.deepEqual(readFileSync(join(dir, 'languages', 'template.lang')), first);
      assert.doesNotMatch(forge('i18n', 'check', '--project', dir).stdout, /phrases \(/);
    });
  });

  it('when the project has an error, then extract exits 1 and writes nothing', () => {
    withApp(undefined, (dir) => {
      writeFileSync(join(dir, 'App.css'), 'window { margin-top: 4px; }\n');
      const result = forge('i18n', 'extract', '--project', dir);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /error: App\.css:1:10/);
      assert.ok(!existsSync(join(dir, 'languages')));
    });
  });
});

describe('given translations that cover part of the app', () => {
  const partial = 'Greet\tCumprimentar\nGone\tSumiu\n';

  it('when running forge i18n check, then it prints coverage, missing phrases and orphans and exits 0', () => {
    withApp({ 'pt-BR.lang': partial }, (dir) => {
      const result = forge('i18n', 'check', '--project', dir);
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /^pt-BR: 1\/2 phrases \(50%\)$/m);
      assert.match(result.stdout, /^  missing: Hello, forge$/m);
      assert.match(result.stdout, /^  orphan: Gone$/m);
    });
  });

  it('when --strict is given, then missing or orphan phrases make the exit code 1', () => {
    withApp({ 'pt-BR.lang': partial }, (dir) => {
      assert.equal(forge('i18n', 'check', '--project', dir, '--strict').status, 1);
    });
  });

  it('when everything is translated, then --strict exits 0 and coverage is 100%', () => {
    withApp({ 'pt-BR.lang': 'Greet\tCumprimentar\nHello, forge\tOlá, forge\n' }, (dir) => {
      const result = forge('i18n', 'check', '--project', dir, '--strict');
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /^pt-BR: 2\/2 phrases \(100%\)$/m);
    });
  });

  it('when a file has an error, then check exits 1 even without --strict and names file:line', () => {
    withApp({ 'pt-BR.lang': 'Greet\tOi %s\n' }, (dir) => {
      const result = forge('i18n', 'check', '--project', dir);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /error: languages\/pt-BR\.lang:1: /);
    });
  });

  it('when there are no translations at all, then check says so and exits 0', () => {
    withApp(undefined, (dir) => {
      const result = forge('i18n', 'check', '--project', dir);
      assert.equal(result.status, 0);
      assert.match(result.stdout, /no translations/);
    });
  });
});

describe('given a bad forge i18n command line', () => {
  it('when the action is missing or unknown, then usage goes to stderr and the exit code is 2', () => {
    for (const args of [['i18n'], ['i18n', 'translate']]) {
      const result = forge(...args);
      assert.equal(result.status, 2);
      assert.match(result.stderr, /forge i18n extract/);
    }
  });
});
