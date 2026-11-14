import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateLinuxUi } from '../../src/gen/linux.ts';
import { helloIr, node, serializers } from './helpers.ts';

export const GOLDEN_LINUX_DIR = new URL('../golden/ir-hello-linux/', import.meta.url).pathname;
const APP_ID = 'local.forge.hello';
const gen = (ir = helloIr()) => generateLinuxUi(ir, APP_ID);

describe('given the hello IR', () => {
  it('when generating the GTK UI, then it matches golden/ir-hello-linux/ui_linux.cpp', (t) => {
    t.assert.fileSnapshot(gen(), GOLDEN_LINUX_DIR + 'ui_linux.cpp', { serializers });
  });

  const source = gen();
  it('when generating, then the application carries the app id', () => {
    assert.ok(source.includes('gtk_application_new("local.forge.hello", G_APPLICATION_DEFAULT_FLAGS)'));
  });
  it('when generating, then the root is a vertical box with gap 12 and the window is 320x150 min and default', () => {
    assert.ok(source.includes('gtk_box_new(GTK_ORIENTATION_VERTICAL, 12)'));
    assert.ok(source.includes('gtk_window_set_default_size(GTK_WINDOW(window), 320, 120);'));
    assert.ok(source.includes('gtk_widget_set_size_request(window, 320, 120);'));
  });
  it('when generating, then padding, color and font come from a CSS provider on the widget name', () => {
    assert.ok(source.includes('gtk_widget_set_name(w_window_0, "w_window_0");'));
    assert.ok(source.includes('#w_window_0 { padding: 20px 20px 20px 20px; }'));
    assert.ok(source.includes('#w_text_1 { color: rgba(34, 34, 34, 1); font-size: 15px; }'));
  });
  it('when generating, then the CSS loads with the GTK 4.12 call and falls back for older GTK', () => {
    assert.ok(source.includes('#if GTK_CHECK_VERSION(4, 12, 0)'));
    assert.ok(source.includes('gtk_css_provider_load_from_string'));
    assert.ok(source.includes('gtk_css_provider_load_from_data'));
  });
  it('when generating, then the button click runs the greet action on the surface', () => {
    assert.ok(source.includes('g_signal_connect(w_button_2, "clicked", G_CALLBACK(on_click), GINT_TO_POINTER(0));'));
    assert.ok(source.includes('action_greet(g_surface);'));
  });
  it('when generating, then the state-bound label starts with the initial text and follows the state', () => {
    assert.ok(source.includes('gtk_label_new("Press the button")') || source.includes('gtk_label_set_text(GTK_LABEL(w_text_1), "Press the button")'));
    assert.ok(source.includes('g_surface.bind(StateId::s0, w_text_1, false);'));
  });
  it('when generating, then Ctrl+Q quits', () => {
    assert.ok(source.includes('"<Control>q"'));
  });
  it('when generating, then the window title is the root title', () => {
    assert.ok(source.includes('gtk_window_set_title(GTK_WINDOW(window), "Hello, forge");'));
  });
});

describe('given alignment and justification', () => {
  const generate = (style: Record<string, string | number | number[]>, children = helloIr().root.children) => {
    const ir = helloIr();
    ir.root.style = { width: 320, height: 120, ...style };
    ir.root.children = children;
    return gen(ir);
  };
  it('when the root is a row, then the box is horizontal', () => {
    assert.ok(generate({ flexDirection: 'row' }).includes('GTK_ORIENTATION_HORIZONTAL'));
  });
  it('when alignItems is center, then children get halign center in a vertical box', () => {
    assert.ok(generate({ alignItems: 'center' }).includes('gtk_widget_set_halign(w_text_1, GTK_ALIGN_CENTER);'));
  });
  it('when alignItems stretches, then children without a cross size fill and sized ones start', () => {
    const source = generate({ alignItems: 'stretch' });
    assert.ok(source.includes('gtk_widget_set_halign(w_text_1, GTK_ALIGN_FILL);'));
    assert.ok(source.includes('gtk_widget_set_halign(w_button_2, GTK_ALIGN_START);'));
  });
  it('when justifyContent is center, then the children live in an expanding inner box centered on the main axis', () => {
    const source = generate({ justifyContent: 'center' });
    assert.ok(source.includes('gtk_widget_set_valign(inner_window_0, GTK_ALIGN_CENTER);'));
    assert.ok(source.includes('gtk_widget_set_vexpand(inner_window_0, TRUE);'));
    assert.ok(source.includes('gtk_box_append(GTK_BOX(inner_window_0), w_text_1);'));
  });
  it('when justifyContent is end, then the inner box aligns to the end', () => {
    assert.ok(generate({ flexDirection: 'row', justifyContent: 'end' }).includes('gtk_widget_set_halign(inner_window_0, GTK_ALIGN_END);'));
  });
  it('when justifyContent is space-between, then an expanding spacer sits between the children and the gap becomes a margin', () => {
    const source = generate({ justifyContent: 'space-between', gap: 8 });
    assert.ok(source.includes('GtkWidget* spacer_window_0_0 = gtk_box_new(GTK_ORIENTATION_VERTICAL, 0);'));
    assert.ok(source.includes('gtk_widget_set_vexpand(spacer_window_0_0, TRUE);'));
    assert.ok(source.includes('gtk_widget_set_margin_top(w_button_2, 8);'));
    assert.ok(source.includes('gtk_box_new(GTK_ORIENTATION_VERTICAL, 0)'));
  });
  it('when a child has flex > 0, then it expands along the main axis', () => {
    const grow = node('text', 'grow', { style: { flex: 1 }, content: { kind: 'literal', value: 'x' } });
    assert.ok(generate({ flexDirection: 'row' }, [grow]).includes('gtk_widget_set_hexpand(w_grow, TRUE);'));
  });
});

describe('given painted containers and text', () => {
  const ir = helloIr();
  ir.root.style = { ...ir.root.style, background: '#102030ff', borderRadius: 6 };
  ir.root.children[0].style = { ...ir.root.children[0].style, fontWeight: 700, textAlign: 'right' };
  const source = gen(ir);
  it('when generating, then the background and radius go to CSS', () => {
    assert.ok(source.includes('background-color: rgba(16, 32, 48, 1); border-radius: 6px;'));
  });
  it('when generating, then bold is a CSS weight and text alignment moves the label xalign', () => {
    assert.ok(source.includes('font-weight: 700;'));
    assert.ok(source.includes('gtk_label_set_xalign(GTK_LABEL(w_text_1), 1.0f);'));
  });
});

describe('given a language select', () => {
  it('when there is no i18n, then generating fails like the macOS generator does', () => {
    const ir = helloIr();
    ir.root.children.push(node('select', 'select_3', { select: { language: true } }));
    assert.throws(() => gen(ir), { message: '<select language> needs at least one language pack' });
  });
});
