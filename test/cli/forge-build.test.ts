import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('../../', import.meta.url).pathname;
const fixture = join(root, 'test/fixtures/hello-app');
const GENERATED_FILES = [
  'CMakeLists.txt', 'actions.cpp', 'cli_router.cpp', 'cli_surface.hpp', 'dmg', 'forge_app.hpp', 'main.cpp', 'ui_macos.mm',
];
let out = '';

function forge(...args: string[]) {
  return spawnSync(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', join(root, 'src/cli/forge.ts'), ...args], { encoding: 'utf8' });
}

function withProjectCopy(change: (dir: string) => void, run: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'forge-bad-'));
  try {
    cpSync(fixture, dir, { recursive: true });
    change(dir);
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('given an app with package.json, App.tsx and App.css', () => {
  before(() => { out = mkdtempSync(join(tmpdir(), 'forge-build-')); });
  after(() => rmSync(out, { recursive: true, force: true }));

  it('when running "forge build --target macos", then the output holds every generated and runtime file and the exit code is 0', () => {
    const result = forge('build', '--project', fixture, '--target', 'macos', '--out', out);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readdirSync(out).sort(), GENERATED_FILES);
  });

  it('when the app is built, then the generated sources carry the app data (version, state text, command)', () => {
    assert.ok(readFileSync(join(out, 'forge_app.hpp'), 'utf8').includes('APP_VERSION = "0.1.0"'));
    assert.ok(readFileSync(join(out, 'ui_macos.mm'), 'utf8').includes('Press the button'));
    assert.ok(readFileSync(join(out, 'cli_router.cpp'), 'utf8').includes('"--greet"'));
  });

  it('when running forge build twice on the same project, then the outputs are byte-identical', () => {
    const second = mkdtempSync(join(tmpdir(), 'forge-build-'));
    try {
      assert.equal(forge('build', '--project', fixture, '--out', second).status, 0);
      for (const name of readdirSync(out, { recursive: true })) {
        if (statSync(join(out, String(name))).isDirectory()) continue;
        assert.deepEqual(readFileSync(join(second, String(name))), readFileSync(join(out, String(name))), String(name));
      }
    } finally {
      rmSync(second, { recursive: true, force: true });
    }
  });

  it('when run with no subcommand or without --out, then usage goes to stderr and the exit code is 2', () => {
    for (const args of [[], ['build']]) {
      const result = forge(...args);
      assert.equal(result.status, 2);
      assert.match(result.stderr, /Usage:\n\s+forge build/);
    }
  });

  it('when the target is not supported, then the exit code is 1 and stderr names the target', () => {
    const result = forge('build', '--project', fixture, '--target', 'beos', '--out', out);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /unsupported target "beos" \(supported: macos, linux\)/);
  });
});

describe('given an app with an icon.svg', () => {
  it('when running forge build, then AppIcon.icns is written next to the generated sources and CMake bundles it', () => {
    const target = mkdtempSync(join(tmpdir(), 'forge-icon-out-'));
    withProjectCopy((dir) => {
      writeFileSync(join(dir, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#09f"/></svg>');
    }, (dir) => {
      const result = forge('build', '--project', dir, '--out', target);
      assert.equal(result.status, 0, result.stderr);
      assert.ok(readdirSync(target).includes('AppIcon.icns'));
      assert.equal(readFileSync(join(target, 'AppIcon.icns')).subarray(0, 4).toString('latin1'), 'icns');
      assert.ok(readFileSync(join(target, 'CMakeLists.txt'), 'utf8').includes('MACOSX_BUNDLE_ICON_FILE AppIcon'));
    });
    rmSync(target, { recursive: true, force: true });
  });

  it('when icon.svg is invalid, then forge build exits 1 with icon.svg:line:column and writes nothing', () => {
    const target = mkdtempSync(join(tmpdir(), 'forge-icon-bad-'));
    withProjectCopy((dir) => writeFileSync(join(dir, 'icon.svg'), '<svg viewBox="0 0 10 10">\n<image/></svg>'), (dir) => {
      const result = forge('build', '--project', dir, '--out', target);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /error: icon\.svg:2:1: unsupported element <image>/);
      assert.deepEqual(readdirSync(target), []);
    });
    rmSync(target, { recursive: true, force: true });
  });
});

describe('given an app with an icon/ folder of glass layers', () => {
  const glassFixture = join(root, 'test/fixtures/glass-app');

  it('when running forge build, then AppIcon.icon/ is written next to the sources and CMake compiles it', () => {
    const target = mkdtempSync(join(tmpdir(), 'forge-glass-out-'));
    try {
      const result = forge('build', '--project', glassFixture, '--out', target);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(readdirSync(join(target, 'AppIcon.icon'), { recursive: true }).map(String).sort(), ['Assets', 'Assets/background.svg', 'Assets/foreground-1.svg', 'icon.json']);
      assert.ok(readFileSync(join(target, 'CMakeLists.txt'), 'utf8').includes('xcrun actool'));
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  it('when a layer is invalid, then forge build exits 1 with icon/<file>:line:column and writes nothing', () => {
    const target = mkdtempSync(join(tmpdir(), 'forge-glass-bad-'));
    withProjectCopy((dir) => {
      mkdirSync(join(dir, 'icon'));
      writeFileSync(join(dir, 'icon/background.svg'), '<svg viewBox="0 0 10 10">\n<image/></svg>');
      writeFileSync(join(dir, 'icon/foreground-1.svg'), '<svg viewBox="0 0 10 10"/>');
    }, (dir) => {
      const result = forge('build', '--project', dir, '--out', target);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /error: icon\/background\.svg:2:1: unsupported element <image>/);
      assert.deepEqual(readdirSync(target), []);
    });
    rmSync(target, { recursive: true, force: true });
  });
});

describe('given an app with several mistakes', () => {
  it('when running forge build, then every error is listed on stderr with its position, the exit code is 1 and nothing is written', () => {
    const target = mkdtempSync(join(tmpdir(), 'forge-bad-out-'));
    withProjectCopy((dir) => {
      writeFileSync(join(dir, 'App.css'), 'window { margin-top: 4px; }\n');
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      pkg.version = '1.0';
      writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg));
    }, (dir) => {
      const result = forge('build', '--project', dir, '--out', target);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /error: package\.json: version "1\.0" must be semver/);
      assert.match(result.stderr, /error: App\.css:1:10: unknown property "margin-top"/);
      assert.deepEqual(readdirSync(target), []);
    });
    rmSync(target, { recursive: true, force: true });
  });
});

describe('given the bin/forge shim', () => {
  it('when invoked through a symlink elsewhere on disk, then it still finds the forge sources and builds', () => {
    const bin = mkdtempSync(join(tmpdir(), 'forge-bin-'));
    const target = mkdtempSync(join(tmpdir(), 'forge-bin-out-'));
    try {
      symlinkSync(join(root, 'bin/forge'), join(bin, 'forge'));
      const result = spawnSync(join(bin, 'forge'), ['build', '--project', fixture, '--out', target], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      assert.ok(readdirSync(target).includes('ui_macos.mm'));
    } finally {
      rmSync(bin, { recursive: true, force: true });
      rmSync(target, { recursive: true, force: true });
    }
  });
});

const PT_ALL = 'Hello, forge\tOlá, forge\nGreet\tCumprimentar\n';

function buildWithI18n(files: Record<string, string>, extraArgs: string[], pkgChange?: (pkg: Record<string, unknown>) => void) {
  const target = mkdtempSync(join(tmpdir(), 'forge-i18n-out-'));
  let result!: ReturnType<typeof forge>;
  let packs: Record<string, Buffer> = {};
  let written: string[] = [];
  withProjectCopy((dir) => {
    mkdirSync(join(dir, 'languages'));
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, 'languages', name), text);
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    pkg.repository = 'github:camaleaun/forge-hello-world';
    pkgChange?.(pkg);
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg));
  }, (dir) => {
    result = forge('build', '--project', dir, '--out', target, ...extraArgs);
    written = readdirSync(target, { recursive: true }).map(String).sort();
    if (written.includes('lang')) for (const name of readdirSync(join(target, 'lang'))) packs[name] = readFileSync(join(target, 'lang', name));
  });
  rmSync(target, { recursive: true, force: true });
  return { result, packs, written };
}

describe('given an app with languages/pt-BR.lang', () => {
  it('when running forge build, then lang/<app>-<version>-<tag>.lang is written with the pack header and the translations', () => {
    const { result, packs, written } = buildWithI18n({ 'pt-BR.lang': PT_ALL }, []);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.deepEqual(Object.keys(packs), ['hello-0.1.0-pt-BR.lang']);
    const text = packs['hello-0.1.0-pt-BR.lang'].toString('utf8');
    assert.ok(text.startsWith('forge-lang 1 pt-BR hello 0.1.0\nplural-forms: nplurals=2; plural=(n > 1);\n'));
    assert.ok(text.includes('Greet\tCumprimentar\n'));
    assert.ok(written.includes('ui_macos.mm'));
  });

  it('when running forge build, then the i18n runtime files are copied next to the generated sources', () => {
    const { result, written } = buildWithI18n({ 'pt-BR.lang': PT_ALL }, []);
    assert.equal(result.status, 0, result.stderr);
    for (const name of ['i18n.cpp', 'i18n.hpp', 'i18n_loader.hpp', 'i18n_common.cpp', 'i18n_platform.hpp', 'i18n_macos.mm', 'messages.cpp']) assert.ok(written.includes(name), name);
  });

  it('when there are no packs, then no i18n runtime files are copied', () => {
    const { written } = buildWithI18n({ 'template.lang': 'Greet\t\n' }, []);
    for (const name of ['i18n.cpp', 'i18n.hpp', 'i18n_loader.hpp', 'i18n_common.cpp', 'i18n_platform.hpp', 'i18n_macos.mm']) assert.ok(!written.includes(name), name);
  });

  it('when the same project is built twice, then the pack bytes are identical', () => {
    const a = buildWithI18n({ 'pt-BR.lang': PT_ALL }, []).packs;
    const b = buildWithI18n({ 'pt-BR.lang': PT_ALL }, []).packs;
    assert.deepEqual(a, b);
  });

  it('when a phrase is untranslated, then a warning goes to stderr, the exit code is 0 and the pack is written', () => {
    const { result, packs } = buildWithI18n({ 'pt-BR.lang': 'Greet\tCumprimentar\n' }, []);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, /warning: languages\/pt-BR\.lang: missing "Hello, forge"/);
    assert.equal(Object.keys(packs).length, 1);
  });

  it('when --strict-i18n is given and a phrase is untranslated, then the same message is an error, the exit code is 1 and nothing is written', () => {
    const { result, written } = buildWithI18n({ 'pt-BR.lang': 'Greet\tCumprimentar\n' }, ['--strict-i18n']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /error: languages\/pt-BR\.lang: missing "Hello, forge"/);
    assert.deepEqual(written, []);
  });

  it('when --strict-i18n is given and everything is translated, then it builds', () => {
    const { result, packs } = buildWithI18n({ 'pt-BR.lang': PT_ALL }, ['--strict-i18n']);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(Object.keys(packs).length, 1);
  });

  it('when package.json has no repository, then it warns that packs cannot be downloaded and --strict-i18n makes it an error', () => {
    const lax = buildWithI18n({ 'pt-BR.lang': PT_ALL }, [], (pkg) => { delete pkg.repository; });
    assert.equal(lax.result.status, 0, lax.result.stderr);
    assert.match(lax.result.stderr, /warning: package\.json: no "repository": language packs cannot be downloaded/);
    const strict = buildWithI18n({ 'pt-BR.lang': PT_ALL }, ['--strict-i18n'], (pkg) => { delete pkg.repository; });
    assert.equal(strict.result.status, 1);
    assert.match(strict.result.stderr, /error: package\.json: no "repository"/);
    assert.deepEqual(strict.written, []);
  });

  it('when a translation changes the placeholders, then the exit code is 1 with file:line and nothing is written', () => {
    const { result, written } = buildWithI18n({ 'pt-BR.lang': 'Greet\tOi %s\n' }, []);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /error: languages\/pt-BR\.lang:1: /);
    assert.deepEqual(written, []);
  });

  it('when en.lang or a badly named file exists, then the exit code is 1 and stderr names it', () => {
    const { result } = buildWithI18n({ 'en.lang': 'Greet\tHi\n', 'portuguese.lang': 'Greet\tOi\n' }, []);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /error: languages\/en\.lang/);
    assert.match(result.stderr, /error: languages\/portuguese\.lang/);
  });

  it('when languages/ has only template.lang, then no lang/ folder is written and there are no warnings', () => {
    const { result, written } = buildWithI18n({ 'template.lang': 'Greet\t\n' }, []);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.ok(!written.includes('lang'));
  });
});

describe('given an app with a <select language> element', () => {
  function withSelect(files: Record<string, string>, run: (result: ReturnType<typeof forge>, written: string[]) => void) {
    const target = mkdtempSync(join(tmpdir(), 'forge-select-out-'));
    withProjectCopy((dir) => {
      mkdirSync(join(dir, 'languages'));
      for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, 'languages', name), text);
      const app = readFileSync(join(dir, 'App.tsx'), 'utf8').replace('<button', '<select language />\n      <button');
      writeFileSync(join(dir, 'App.tsx'), app);
    }, (dir) => {
      const result = forge('build', '--project', dir, '--out', target);
      run(result, readdirSync(target));
    });
    rmSync(target, { recursive: true, force: true });
  }

  it('when no language file produced a pack, then forge build exits 1 with the select error and writes nothing', () => {
    withSelect({}, (result, written) => {
      assert.equal(result.status, 1);
      assert.match(result.stderr, /error: <select language> needs at least one language file in languages\//);
      assert.deepEqual(written, []);
    });
  });

  it('when every language file had errors, then the select error comes as well', () => {
    withSelect({ 'pt-BR.lang': 'Greet\tOi %s\n' }, (result) => {
      assert.equal(result.status, 1);
      assert.match(result.stderr, /error: languages\/pt-BR\.lang:1: /);
      assert.match(result.stderr, /error: <select language> needs at least one language file/);
    });
  });

  it('when there is a language pack, then it builds', () => {
    withSelect({ 'pt-BR.lang': PT_ALL }, (result, written) => {
      assert.equal(result.status, 0, result.stderr);
      assert.ok(written.includes('lang'));
    });
  });
});

describe('given forge build --target linux', () => {
  it('when building the hello app, then the output has the Linux sources and runtime, with no macOS files', () => {
    const target = mkdtempSync(join(tmpdir(), 'forge-linux-out-'));
    try {
      const result = forge('build', '--project', fixture, '--target', 'linux', '--out', target);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(readdirSync(target).sort(), [
        'CMakeLists.txt', 'actions.cpp', 'cli_router.cpp', 'cli_surface.hpp', 'forge_app.hpp', 'local.forge.hello.desktop', 'local.forge.hello.metainfo.xml', 'main.cpp', 'snap', 'ui_linux.cpp',
      ]);
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });
});

describe('given forge build --target linux with package metadata and an icon', () => {
  it('when building, then the metainfo and .desktop carry description, license and homepage, and the icons are written', () => {
    const target = mkdtempSync(join(tmpdir(), 'forge-linux-meta-'));
    withProjectCopy((dir) => {
      const path = join(dir, 'package.json');
      const pkg = JSON.parse(readFileSync(path, 'utf8'));
      writeFileSync(path, JSON.stringify({ ...pkg, description: 'Says hello', license: 'MIT', homepage: 'https://example.org/hello', forge: { ...pkg.forge, appId: 'org.example.Hello' } }));
      writeFileSync(join(dir, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="#09f"/></svg>');
    }, (dir) => {
      const result = forge('build', '--project', dir, '--target', 'linux', '--out', target);
      assert.equal(result.status, 0, result.stderr);
      const metainfo = readFileSync(join(target, 'org.example.Hello.metainfo.xml'), 'utf8');
      assert.ok(metainfo.includes('<project_license>MIT</project_license>'));
      assert.ok(metainfo.includes('<url type="homepage">https://example.org/hello</url>'));
      assert.ok(readFileSync(join(target, 'org.example.Hello.desktop'), 'utf8').includes('Comment=Says hello'));
      assert.ok(readFileSync(join(target, 'ui_linux.cpp'), 'utf8').includes('"org.example.Hello"'));
      assert.ok(readdirSync(join(target, 'icons/hicolor/48x48/apps')).includes('org.example.Hello.png'));
    });
    rmSync(target, { recursive: true, force: true });
  });
});
