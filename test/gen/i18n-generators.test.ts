import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateActionsCpp } from '../../src/gen/actions-cpp.ts';
import { generateAppHeader } from '../../src/gen/app-header.ts';
import { generateCliRouter } from '../../src/gen/cli-router.ts';
import { generateCmake } from '../../src/gen/cmake.ts';
import { generateMacosUi } from '../../src/gen/macos.ts';
import { generateMessagesCpp } from '../../src/gen/messages-cpp.ts';
import { generateProject, runtimeFilesFor, RUNTIME_FILES, RUNTIME_DIR } from '../../src/gen/index.ts';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { goldenI18n, helloI18nIr, helloI18nOptions, helloIr, node, serializers } from './helpers.ts';

describe('given the hello IR with messages, a language dropdown and one language pack', () => {
  const ir = helloI18nIr();
  const options = helloI18nOptions();

  it('when generating forge_app.hpp, then it matches golden/ir-hello-i18n/forge_app.hpp', (t) => {
    t.assert.fileSnapshot(generateAppHeader(ir, true), goldenI18n('forge_app.hpp'), { serializers });
  });
  it('when generating actions.cpp, then effects are Text values (messages by index, plurals with count and args)', (t) => {
    t.assert.fileSnapshot(generateActionsCpp(ir, true), goldenI18n('actions.cpp'), { serializers });
  });
  it('when generating messages.cpp, then it matches golden/ir-hello-i18n/messages.cpp', (t) => {
    t.assert.fileSnapshot(generateMessagesCpp(ir, options), goldenI18n('messages.cpp'), { serializers });
  });
  it('when generating cli_router.cpp, then help descriptions are rendered through the active language', (t) => {
    t.assert.fileSnapshot(generateCliRouter(ir, true), goldenI18n('cli_router.cpp'), { serializers });
  });
  it('when generating ui_macos.mm, then it matches golden/ir-hello-i18n/ui_macos.mm (Language menu and dropdown)', (t) => {
    t.assert.fileSnapshot(generateMacosUi(ir, options), goldenI18n('ui_macos.mm'), { serializers });
  });
  it('when generating CMakeLists.txt, then the i18n sources are listed', (t) => {
    t.assert.fileSnapshot(generateCmake(ir, true), goldenI18n('CMakeLists.txt'), { serializers });
  });
});

describe('given i18n options with the Language menu off', () => {
  const source = generateMacosUi(helloI18nIr(), helloI18nOptions({ menu: false }));
  it('when generating the UI, then no Language menu is built but the dropdown is', () => {
    assert.ok(!source.includes('languageMenu'));
    assert.ok(!source.includes('Auto (system language)'));
    assert.ok(source.includes('NSPopUpButton* w_select_3'));
  });
});

describe('given a dropdown and several packs', () => {
  it('when generating the UI, then English comes first, then one endonym per pack, and no Auto item', () => {
    const options = helloI18nOptions({
      menu: false,
      packs: [
        { tag: 'pt-BR', file: 'a-pt-BR.lang', sha256: 'a'.repeat(64), size: 1 },
        { tag: 'fr', file: 'a-fr.lang', sha256: 'b'.repeat(64), size: 1 },
      ],
    });
    const source = generateMacosUi(helloI18nIr(), options);
    const items = [...source.matchAll(/add_language_item\(\[w_select_3 menu\], w_select_3, target, ("[^"]*"), Text\("([^"]*)"\)\);/g)].map((m) => [m[1], m[2]]);
    assert.deepEqual(items, [['"en"', 'English'], ['"pt-BR"', 'Português (Brasil)'], ['"fr"', 'Français']]);
  });
});

describe('given a dropdown without any language pack', () => {
  it('when generating the project, then it throws', () => {
    const options = helloI18nOptions({ packs: [] });
    assert.throws(() => generateProject(helloI18nIr(), 'macos', { i18n: options }), { message: '<select language> needs at least one language pack' });
    assert.throws(() => generateProject(helloI18nIr(), 'macos'), { message: '<select language> needs at least one language pack' });
  });
});

describe('given an IR with messages and a quote in a context', () => {
  it('when generating messages.cpp, then contexts and plurals are escaped C++ strings and the table is never empty', () => {
    const ir = helloI18nIr();
    ir.messages = [{ context: 'a "b"', text: 'x\ny' }];
    assert.ok(generateMessagesCpp(ir, helloI18nOptions()).includes('{"a \\"b\\"", "x\\ny", nullptr},'));
    ir.messages = [];
    const empty = generateMessagesCpp(ir, helloI18nOptions());
    assert.ok(empty.includes('{nullptr, nullptr, nullptr},'));
    assert.ok(empty.includes('const int MSG_COUNT = 0;'));
  });
  it('when the same input is generated twice, then the output is identical', () => {
    assert.equal(generateMessagesCpp(helloI18nIr(), helloI18nOptions()), generateMessagesCpp(helloI18nIr(), helloI18nOptions()));
  });
  it('when download and menu are off, then the constants say so', () => {
    const source = generateMessagesCpp(helloI18nIr(), helloI18nOptions({ download: false, menu: false }));
    assert.ok(source.includes('const bool DOWNLOAD_ENABLED = false;'));
    assert.ok(source.includes('const bool MENU_ENABLED = false;'));
  });
});

describe('given message texts with a context, args and a literal', () => {
  it('when generating actions and UI, then contexts select the right table entry and literals stay literals', () => {
    const ir = helloI18nIr();
    ir.messages = [{ text: 'Greet' }, { context: 'noun', text: 'Greet' }];
    ir.handlers[0].effects[0].value = { kind: 'message', text: 'Greet', context: 'noun' };
    ir.handlers[1].effects[0].value = { kind: 'literal', value: 'plain' };
    assert.ok(generateActionsCpp(ir, true).includes('Text::msg(1)'));
    assert.ok(generateActionsCpp(ir, true).includes('Text("plain")'));
  });
});

describe('given an IR without translatable messages, or no packs', () => {
  it('when generating the project with undefined i18n or empty packs, then the files are byte-identical to the plain project', () => {
    const plain = generateProject(helloIr(), 'macos');
    for (const i18n of [undefined, helloI18nOptions({ packs: [] })]) {
      const files = generateProject(helloIr(), 'macos', { i18n });
      assert.deepEqual([...files.keys()], [...plain.keys()]);
      for (const [name, content] of plain) assert.deepEqual(files.get(name), content, name);
    }
    assert.ok(!plain.has('messages.cpp'));
  });
  it('when asking for the runtime files, then only apps with packs get the i18n files', () => {
    assert.deepEqual(runtimeFilesFor(undefined), RUNTIME_FILES);
    assert.deepEqual(runtimeFilesFor(helloI18nOptions({ packs: [] })), RUNTIME_FILES);
    assert.deepEqual(runtimeFilesFor(helloI18nOptions()), [...RUNTIME_FILES, 'i18n_loader.hpp', 'i18n.hpp', 'i18n.cpp', 'i18n_common.cpp', 'i18n_platform.hpp', 'i18n_macos.mm', 'http.hpp', 'http_adapter.hpp', 'http_common.cpp', 'http_macos.mm']);
    for (const file of runtimeFilesFor(helloI18nOptions())) assert.ok(existsSync(join(RUNTIME_DIR, file)), file);
  });
});

describe('given the project of an i18n app', () => {
  it('when generating it, then messages.cpp and the i18n CMake sources are included', () => {
    const files = generateProject(helloI18nIr(), 'macos', { i18n: helloI18nOptions() });
    assert.ok((files.get('messages.cpp') as string).includes('MSG_COUNT = 8'));
    assert.match(files.get('CMakeLists.txt') as string, /messages\.cpp\n {2}i18n\.cpp\n {2}i18n_common\.cpp\n {2}i18n_macos\.mm\n {2}http_common\.cpp\n {2}http_macos\.mm\)/);
    assert.ok((files.get('ui_macos.mm') as string).includes('Text::msg(2)'));
  });
  it('when the IR has no select node and no menu, then no language UI is emitted', () => {
    const ir = helloI18nIr();
    ir.root.children = ir.root.children.filter((child) => child.kind !== 'select');
    const source = generateMacosUi(ir, helloI18nOptions({ menu: false }));
    assert.ok(!source.includes('add_language_item(languageMenu') && !source.includes('NSPopUpButton* w_'));
  });
});

describe('given the macOS language loader source', () => {
  it('when it stores the language choice, then it uses the standard user defaults (a suite named like the bundle id is refused by macOS)', () => {
    const source = readFileSync(join(RUNTIME_DIR, 'i18n_macos.mm'), 'utf8');
    assert.ok(!source.includes('initWithSuiteName'), 'initWithSuiteName with the own bundle id does not work');
    assert.ok(source.includes('standardUserDefaults'));
  });
});

describe('given an i18n project', () => {
  const files = generateProject(helloI18nIr(), 'macos', { i18n: helloI18nOptions() });
  it('when generating, then forge\'s own help texts are messages the language pack can translate', () => {
    assert.match(String(files.get('messages.cpp')), /"Show this help"/);
    assert.match(String(files.get('messages.cpp')), /"Print the version"/);
    const router = String(files.get('cli_router.cpp'));
    assert.match(router, /--version  ", Text::msg\(\d+\)\)/);
    assert.match(router, /--help     ", Text::msg\(\d+\)\)/);
  });
});
