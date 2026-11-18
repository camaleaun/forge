import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('../../', import.meta.url).pathname;
const fixture = join(root, 'test/fixtures/hello-app');
const PT = 'Greet\tCumprimentar\nHello, forge\tOlá, forge\n';
const FR = 'Greet\tSaluer\nHello, forge\tBonjour, forge\n';

function forge(...args: string[]) {
  return spawnSync(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', join(root, 'src/cli/forge.ts'), ...args], { encoding: 'utf8' });
}

// A copy of the hello app with the given language files; run gets the project and an output folder.
function withApp(files: Record<string, string>, run: (dir: string, out: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'forge-bundle-'));
  try {
    cpSync(fixture, dir, { recursive: true });
    mkdirSync(join(dir, 'languages'));
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, 'languages', name), text);
    run(dir, join(dir, 'out'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('given forge build --bundle-locale', () => {
  for (const target of ['macos', 'linux']) {
    it(`when the tag is one of the project's packs (${target}), then messages.cpp embeds that pack and no HTTP files are copied`, () => {
      withApp({ 'pt-BR.lang': PT }, (dir, out) => {
        const result = forge('build', '--project', dir, '--target', target, '--out', out, '--bundle-locale', 'pt-BR');
        assert.equal(result.status, 0, result.stderr);
        const messages = readFileSync(join(out, 'messages.cpp'), 'utf8');
        assert.match(messages, /BUNDLED_LOCALE = "pt-BR"/);
        assert.match(messages, /Cumprimentar/);
        assert.match(readFileSync(join(out, 'forge_app.hpp'), 'utf8'), /#define FORGE_BUNDLED 1/);
        assert.ok(!existsSync(join(out, 'http.hpp')));
        assert.ok(existsSync(join(out, 'i18n_common.cpp')));
        // The pack is still written to lang/ (the release publishes it); the embedded text is that file's text.
        assert.ok(readFileSync(join(out, 'lang', readdirLang(out)), 'utf8').includes('Cumprimentar'));
      });
    });
  }

  it('when the app has two packs and one is bundled, then the other is still downloadable and the HTTP files are copied', () => {
    withApp({ 'pt-BR.lang': PT, 'fr.lang': FR }, (dir, out) => {
      assert.equal(forge('build', '--project', dir, '--out', out, '--bundle-locale', 'fr').status, 0);
      assert.match(readFileSync(join(out, 'messages.cpp'), 'utf8'), /BUNDLED_LOCALE = "fr"/);
      assert.ok(existsSync(join(out, 'http.hpp')));
    });
  });

  it('when the tag is not a pack of the project, then it fails listing the available ones and writes nothing', () => {
    withApp({ 'pt-BR.lang': PT, 'fr.lang': FR }, (dir, out) => {
      const result = forge('build', '--project', dir, '--out', out, '--bundle-locale', 'de');
      assert.equal(result.status, 1);
      assert.match(result.stderr, /error: --bundle-locale de: the project has no language pack with that tag \(available: fr, pt-BR\)/);
      assert.ok(!existsSync(out));
    });
  });

  it('when the project has no languages at all, then it fails saying there are none', () => {
    const dir = mkdtempSync(join(tmpdir(), 'forge-bundle-'));
    try {
      cpSync(fixture, dir, { recursive: true });
      const result = forge('build', '--project', dir, '--out', join(dir, 'out'), '--bundle-locale', 'pt-BR');
      assert.equal(result.status, 1);
      assert.match(result.stderr, /error: --bundle-locale pt-BR: the project has no language packs \(languages\/\)/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('when --bundle-locale has no value, then usage goes to stderr with the exit code 2, and usage lists the flag', () => {
    const result = forge('build', '--out', 'x', '--bundle-locale');
    assert.equal(result.status, 2);
    assert.match(result.stderr, /\[--bundle-locale <tag>\]/);
  });

  it('when --bundle-locale is not given, then the output has no bundled pack', () => {
    withApp({ 'pt-BR.lang': PT }, (dir, out) => {
      assert.equal(forge('build', '--project', dir, '--out', out).status, 0);
      assert.doesNotMatch(readFileSync(join(out, 'messages.cpp'), 'utf8'), /BUNDLED/);
      assert.ok(existsSync(join(out, 'http.hpp')));
    });
  });
});

function readdirLang(out: string): string {
  const names = spawnSync('ls', [join(out, 'lang')], { encoding: 'utf8' }).stdout.trim().split('\n');
  return names[0];
}
