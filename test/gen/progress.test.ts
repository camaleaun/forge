import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateProject } from '../../src/gen/index.ts';
import { layoutOf } from '../../src/gen/layout.ts';
import type { Ir } from '../../src/ir/types.ts';
import { helloIr, node } from './helpers.ts';

function withProgress() {
  const ir = helloIr();
  ir.root.children.push(node('progress', 'progress_3', { progress: { value: 0.25, max: 1 }, style: { width: 200, height: 8, color: '#00aa00ff', flex: 1 } }));
  return ir;
}

describe('given an IR with a <progress>', () => {
  it('when laid out, then the node keeps kind progress, its data, size and color', () => {
    const bar = layoutOf(withProgress().root).children[2];
    assert.equal(bar.kind, 'progress');
    assert.deepEqual(bar.progress, { value: 0.25, max: 1 });
    assert.equal(bar.width, 200);
    assert.equal(bar.height, 8);
    assert.equal(bar.grow, true);
    assert.equal(bar.paint.color, '#00aa00ff');
  });

  const withSource = () => {
    const ir = helloIr();
    ir.root.children.push(node('progress', 'progress_3', { progress: { source: 'language-download' }, style: { width: 160 } }));
    return ir;
  };
  const i18n = { appId: 'dev.forge.hello', packs: [{ tag: 'pt-BR', file: 'hello-0.1.0-pt-BR.lang', sha256: '0'.repeat(64), size: 10 }], baseUrl: 'https://example.com/', download: true, menu: false };
  const ui = (target: 'macos' | 'linux', ir: Ir, options?: typeof i18n) => String(generateProject(ir, target, options ? { i18n: options } : undefined).get(`ui_${target}.${target === 'macos' ? 'mm' : 'cpp'}`));

  describe('on macOS', () => {
    it('when the bar has a value, then it is a determinate NSProgressIndicator bar with the size constraints', () => {
      const source = ui('macos', withProgress());
      assert.ok(source.includes('NSProgressIndicator* w_progress_3 = [[NSProgressIndicator alloc] init];'));
      assert.ok(source.includes('[w_progress_3 setStyle:NSProgressIndicatorStyleBar];'));
      assert.ok(source.includes('[w_progress_3 setIndeterminate:NO];'));
      assert.ok(source.includes('[w_progress_3 setMinValue:0];'));
      assert.ok(source.includes('[w_progress_3 setMaxValue:1];'));
      assert.ok(source.includes('[w_progress_3 setDoubleValue:0.25];'));
      assert.ok(source.includes('[[[w_progress_3 widthAnchor] constraintEqualToConstant:200] setActive:YES];'));
      assert.ok(source.includes('[[[w_progress_3 heightAnchor] constraintEqualToConstant:8] setActive:YES];'));
    });
    it('when the bar is indeterminate, then it is animated', () => {
      const ir = helloIr();
      ir.root.children.push(node('progress', 'busy', { progress: { indeterminate: true } }));
      const source = ui('macos', ir);
      assert.ok(source.includes('[w_busy setIndeterminate:YES];'));
      assert.ok(source.includes('[w_busy startAnimation:nil];'));
    });
    it('when max is given, then the value runs from 0 to max', () => {
      const ir = helloIr();
      ir.root.children.push(node('progress', 'p', { progress: { value: 30, max: 120 } }));
      const source = ui('macos', ir);
      assert.ok(source.includes('[w_p setMaxValue:120];'));
      assert.ok(source.includes('[w_p setDoubleValue:30];'));
    });
    it('when the bar follows the language download, then the surface hides it until a download runs', () => {
      const source = ui('macos', withSource(), i18n);
      assert.ok(source.includes('g_surface.bind_download(w_progress_3);'));
      assert.ok(source.includes('download_active()'));
      assert.ok(source.includes('download_progress("")'));
      assert.ok(source.includes('[bar setHidden:!downloading];'));
    });
    it('when the bar follows the language download but the app has no language packs, then generating fails clearly', () => {
      assert.throws(() => generateProject(withSource(), 'macos'), { message: '<progress source="language-download"> needs at least one language pack' });
    });
  });

  describe('on Linux', () => {
    it('when the bar has a value, then it is a GtkProgressBar with the fraction, the size and the colour of its fill', () => {
      const source = ui('linux', withProgress());
      assert.ok(source.includes('GtkWidget* w_progress_3 = gtk_progress_bar_new();'));
      assert.ok(source.includes('gtk_progress_bar_set_fraction(GTK_PROGRESS_BAR(w_progress_3), 0.25);'));
      assert.ok(source.includes('gtk_widget_set_size_request(w_progress_3, 200, 8);'));
      assert.ok(source.includes('#w_progress_3 progress { background-color: rgba(0, 170, 0, 1); background-image: none; }'));
    });
    it('when max is given, then the fraction is value / max', () => {
      const ir = helloIr();
      ir.root.children.push(node('progress', 'p', { progress: { value: 30, max: 120 } }));
      assert.ok(ui('linux', ir).includes('gtk_progress_bar_set_fraction(GTK_PROGRESS_BAR(w_p), 0.25);'));
    });
    it('when the bar is indeterminate, then a timer pulses it', () => {
      const ir = helloIr();
      ir.root.children.push(node('progress', 'busy', { progress: { indeterminate: true } }));
      const source = ui('linux', ir);
      assert.ok(source.includes('g_timeout_add(100, pulse_bar, w_busy);'));
      assert.ok(source.includes('gtk_progress_bar_pulse(GTK_PROGRESS_BAR(bar))'));
    });
    it('when no bar is indeterminate, then there is no pulse helper', () => {
      assert.ok(!ui('linux', withProgress()).includes('pulse'));
    });
    it('when the bar follows the language download, then it starts hidden and the surface shows it while a download runs', () => {
      const source = ui('linux', withSource(), i18n);
      assert.ok(source.includes('gtk_widget_set_visible(w_progress_3, FALSE);'));
      assert.ok(source.includes('g_surface.add_download_bar(w_progress_3);'));
      assert.ok(source.includes('gtk_widget_set_visible(bar, downloading);'));
      assert.ok(source.includes('gtk_progress_bar_set_fraction(GTK_PROGRESS_BAR(bar), download_progress(""));'));
    });
    it('when the bar follows the language download but the app has no language packs, then generating fails clearly', () => {
      assert.throws(() => generateProject(withSource(), 'linux'), { message: '<progress source="language-download"> needs at least one language pack' });
    });
  });
});
