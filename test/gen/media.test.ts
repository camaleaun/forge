import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateLinuxUi } from '../../src/gen/linux.ts';
import { generateMacosUi } from '../../src/gen/macos.ts';
import { helloI18nOptions, helloIr, serializers, variantsI18nIr, variantsIr } from './helpers.ts';

const GOLDEN = new URL('../golden/ir-hello-variants/', import.meta.url).pathname;
const macos = generateMacosUi(variantsIr());
const linux = generateLinuxUi(variantsIr(), 'dev.forge.hello');

describe('given an IR whose nodes have @media variants', () => {
  it('when generating macOS, then it matches golden/ir-hello-variants/ui_macos.mm', (t) => {
    t.assert.fileSnapshot(macos, GOLDEN + 'ui_macos.mm', { serializers });
  });
  it('when generating Linux, then it matches golden/ir-hello-variants/ui_linux.cpp', (t) => {
    t.assert.fileSnapshot(linux, GOLDEN + 'ui_linux.cpp', { serializers });
  });
});

describe('given the macOS UI of an app with variants', () => {
  it('when the window is resized, then the delegate applies the variants for the size of the content view', () => {
    assert.ok(macos.includes('<NSApplicationDelegate, NSWindowDelegate>'));
    assert.ok(macos.includes('- (void)windowDidResize:(NSNotification*)notification {'));
    assert.ok(macos.includes('[[(NSWindow*)[notification object] contentView] frame].size'));
    assert.ok(macos.includes('[window setDelegate:target];'));
  });
  it('when the window opens, then the variants are applied once for its size, before it is shown', () => {
    assert.match(macos, /g_apply\(\[content frame\]\.size\.width, \[content frame\]\.size\.height\);\n\n {4}\[window makeKeyAndOrderFront:nil\];/);
  });
  it('when a box varies, then gap, padding, direction, background and radius are set from the cascade of its variants', () => {
    assert.ok(macos.includes('[w_window_0 setSpacing:(w >= 400 && h <= 300 ? 2 : (w <= 500 ? 4 : 12))];'));
    assert.ok(macos.includes('[w_window_0 setEdgeInsets:NSEdgeInsetsMake((w <= 500 ? 1 : 20), (w <= 500 ? 4 : 20), (w <= 500 ? 3 : 20), (w <= 500 ? 2 : 20))];'));
    assert.ok(macos.includes('const BOOL hz_window_0 = (w <= 500 ? YES : NO);'));
    assert.ok(macos.includes('[w_window_0 setOrientation:hz_window_0 ? NSUserInterfaceLayoutOrientationHorizontal : NSUserInterfaceLayoutOrientationVertical];'));
    assert.ok(macos.includes('[[w_window_0 layer] setCornerRadius:(w <= 500 ? 6 : 0)];'));
  });
  it('when a child follows the window, then its size and stretch constraints are created inactive and set by the variants', () => {
    assert.ok(macos.includes('NSLayoutConstraint* cw_text_1 = [[w_text_1 widthAnchor] constraintEqualToConstant:0];'));
    assert.ok(macos.includes('NSLayoutConstraint* sw_text_1 = [[w_text_1 widthAnchor] constraintEqualToAnchor:[w_window_0 widthAnchor]];'));
    assert.ok(macos.includes('[cw_text_1 setActive:width >= 0];'));
    assert.ok(macos.includes('[sw_text_1 setActive:!hz_window_0 && width < 0];'));
  });
  it('when text varies, then font, colour and alignment are set from the cascade', () => {
    assert.ok(macos.includes('[w_text_1 setFont:[NSFont systemFontOfSize:(w <= 500 ? 11 : 15) weight:'));
    assert.ok(macos.includes('[w_text_1 setAlignment:(w <= 500 ? NSTextAlignmentCenter : NSTextAlignmentNatural)];'));
  });
  it('when the app has no variants, then none of it is generated', () => {
    const plain = generateMacosUi(helloIr());
    for (const text of ['g_apply', 'windowDidResize', 'NSWindowDelegate', '[window setDelegate:']) assert.ok(!plain.includes(text), text);
  });
  it('when the app has language packs, then the variants work the same way', () => {
    const translated = generateMacosUi(variantsI18nIr(), helloI18nOptions());
    assert.ok(translated.includes('- (void)windowDidResize:'));
    assert.equal(translated.split('[window setDelegate:target];').length, 2);
  });
});

describe('given the Linux UI of an app with variants', () => {
  it('when the window changes size, then the default size and the surface layout both apply the variants for the content size', () => {
    assert.ok(linux.includes('#include <functional>'));
    assert.ok(linux.includes('std::function<void(int, int)> g_apply;'));
    assert.ok(linux.includes('"notify::default-width"'));
    assert.ok(linux.includes('"notify::default-height"'));
    assert.ok(linux.includes('"layout", G_CALLBACK(on_surface_layout)'));
    assert.ok(linux.includes('gtk_widget_get_width(content)'));
  });
  it('when there are variants, then the root sits in a plain frame, whose size (no padding) is the size @media measures', () => {
    assert.ok(linux.includes('gtk_box_append(GTK_BOX(frame), w_window_0);'));
    assert.ok(linux.includes('gtk_window_set_child(GTK_WINDOW(window), frame);'));
    assert.ok(!generateLinuxUi(helloIr(), 'dev.forge.hello').includes('frame'));
  });
  it('when the window opens, then the variants are applied once for its size, before it is shown', () => {
    assert.match(linux, /g_apply\(320, 120\);\n {2}gtk_window_present/);
  });
  it('when a variant sets CSS properties, then it gets a class rule more specific than the base rule, toggled by its query', () => {
    assert.ok(linux.includes('#w_window_0.m0 { padding: 1px 2px 3px 4px; background-color: rgba(16, 32, 48, 1); border-radius: 6px; }'));
    assert.ok(linux.includes('if (w <= 500) gtk_widget_add_css_class(w_window_0, "m0");'));
    assert.ok(linux.includes('else gtk_widget_remove_css_class(w_window_0, "m0");'));
  });
  it('when a box varies, then direction and gap are set from the cascade of its variants', () => {
    assert.ok(linux.includes('const bool hz_window_0 = (w <= 500 ? true : false);'));
    assert.ok(linux.includes('gtk_orientable_set_orientation(GTK_ORIENTABLE(w_window_0), hz_window_0 ? GTK_ORIENTATION_HORIZONTAL : GTK_ORIENTATION_VERTICAL);'));
    assert.ok(linux.includes('gtk_box_set_spacing(GTK_BOX(w_window_0), (w >= 400 && h <= 300 ? 2 : (w <= 500 ? 4 : 12)));'));
  });
  it('when a child follows the window, then its size, growth and alignment are set again', () => {
    assert.ok(linux.includes('gtk_widget_set_size_request(w_text_1, width, height);'));
    assert.ok(linux.includes('gtk_widget_set_hexpand(w_text_1, grow && hz_window_0);'));
    assert.ok(linux.includes('const GtkAlign cross = (hz_window_0 ? height >= 0 : width >= 0) ? GTK_ALIGN_START : GTK_ALIGN_FILL;'));
  });
  it('when a space-between box varies, then its spacers follow the direction and the gap becomes the margin of the right side', () => {
    assert.ok(linux.includes('gtk_orientable_set_orientation(GTK_ORIENTABLE(spacer_inner_0), hz_inner ?'));
    assert.ok(linux.includes('gtk_widget_set_margin_start(w_bar, hz_inner ? (w <= 480 ? 1 : 3) : 0);'));
    assert.ok(linux.includes('gtk_widget_set_margin_top(w_bar, hz_inner ? 0 : (w <= 480 ? 1 : 3));'));
  });
  it('when text alignment varies, then the label xalign follows', () => {
    assert.ok(linux.includes('gtk_label_set_xalign(GTK_LABEL(w_text_1), (w <= 500 ? 0.5f : 0.0f));'));
  });
  it('when the app has no variants, then none of it is generated', () => {
    const plain = generateLinuxUi(helloIr(), 'dev.forge.hello');
    for (const text of ['g_apply', 'std::function', 'notify::default', 'add_css_class']) assert.ok(!plain.includes(text), text);
  });
  it('when the app has language packs, then the variants work the same way', () => {
    const translated = generateLinuxUi(variantsI18nIr(), 'dev.forge.hello', helloI18nOptions());
    assert.ok(translated.includes('std::function<void(int, int)> g_apply;'));
    assert.equal(translated.split('g_apply = [=](int w, int h) {').length, 2);
  });
});
