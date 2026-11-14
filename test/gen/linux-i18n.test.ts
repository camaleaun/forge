import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateLinuxUi } from '../../src/gen/linux.ts';
import { GOLDEN_I18N_DIR, helloI18nIr, helloI18nOptions, helloIr, serializers } from './helpers.ts';

const APP_ID = 'dev.forge.hello';
const gen = (options = helloI18nOptions()) => generateLinuxUi(helloI18nIr(), APP_ID, options);

describe('given the i18n hello IR', () => {
  it('when generating the GTK UI, then it matches golden/ir-hello-i18n/ui_linux.cpp', (t) => {
    t.assert.fileSnapshot(gen(), GOLDEN_I18N_DIR + 'ui_linux.cpp', { serializers });
  });

  const source = gen();
  it('when generating, then the language select is a GtkDropDown with English and the pack endonym, no Auto', () => {
    assert.ok(source.includes('gtk_drop_down_new('));
    assert.ok(source.includes('Text("English")'));
    assert.ok(source.includes('Text("Português (Brasil)")'));
    assert.ok(!source.includes('Auto (system language)'));
  });
  it('when the dropdown selection changes, then choose_language runs, with a re-entrancy guard around refresh_all', () => {
    assert.ok(source.includes('"notify::selected"'));
    assert.ok(source.includes('choose_language(value)'));
    assert.match(source, /if \(g_surface\.refreshing\(\)\) return;/);
    assert.match(source, /\+\+refreshing_;[\s\S]*--refreshing_;/);
  });
  it('when an offline language is picked, then the dropdown goes back to the active language', () => {
    assert.match(source, /if \(language_offline\(value\)\) \{\s*g_surface\.refresh_all\(\);\s*return;/);
    assert.ok(source.includes('Text::tr(" (offline)")'));
  });
  it('when generating, then texts are bound (bind_text for messages, bind_state for states) and rendered by refresh_all', () => {
    assert.ok(source.includes('g_surface.bind_text(Kind::Button, w_button_2, Text::msg(1));'));
    assert.ok(source.includes('g_surface.bind_state(Kind::Label, w_text_1, StateId::s0);'));
    assert.ok(source.includes('g_surface.bind_text(Kind::Window, window, Text::msg(2));'));
    assert.ok(source.includes('void refresh_all()'));
    assert.ok(source.includes('render(text)'));
  });
  it('when the surface sets a state, then it takes a Text and refreshes', () => {
    assert.ok(source.includes('void set_state(StateId id, const Text& text) override'));
    assert.ok(!source.includes('const char* text) override'));
  });
  it('when the app starts, then the stored language is applied before the window and the hook follows language changes', () => {
    assert.ok(source.includes('set_refresh_hook([] { g_surface.refresh_all(); });'));
    assert.ok(source.includes('start_gui_language();'));
    assert.ok(source.includes('g_surface.set_state(StateId::s0, Text::msg(4));'));
  });
});

describe('given an i18n app without a language select', () => {
  it('when generating, then there is no dropdown but texts still follow the language', () => {
    const ir = helloI18nIr();
    ir.root.children = ir.root.children.filter((child) => child.kind !== 'select');
    const source = generateLinuxUi(ir, APP_ID, helloI18nOptions());
    assert.ok(!source.includes('gtk_drop_down_new'));
    assert.ok(source.includes('refresh_all'));
  });
});

describe('given an app without language packs', () => {
  it('when generating, then the UI is the plain one (no Text, no loader)', () => {
    const source = generateLinuxUi(helloIr(), APP_ID);
    assert.ok(!source.includes('refresh_all') && !source.includes('choose_language'));
    assert.throws(() => generateLinuxUi(helloI18nIr(), APP_ID), /language pack/);
  });
});
