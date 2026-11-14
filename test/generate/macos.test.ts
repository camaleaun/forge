import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateMacosUi } from '../../src/generate/macos.ts';
import { hello } from '../helpers/fixtures.ts';

const golden = (name: string) => new URL(`../golden/hello/${name}`, import.meta.url).pathname;

describe('given the hello spec', () => {
  it('when generating the macOS UI, then it matches golden/hello/ui_macos.mm', (t) => {
    t.assert.fileSnapshot(generateMacosUi(hello()), golden('ui_macos.mm'), { serializers: [(value) => value as string] });
  });
});

describe('given a taller window', () => {
  it('when generating, then widget frames are flipped against that height and the window size follows', () => {
    const spec = hello();
    spec.window.height = 200;
    const source = generateMacosUi(spec);
    assert.ok(source.includes('NSMakeRect(20, 156, 280, 24)'), 'label y = 200 - 20 - 24');
    assert.ok(source.includes('NSMakeRect(20, 112, 100, 28)'), 'button y = 200 - 60 - 28');
    assert.ok(source.includes('NSMakeRect(0, 0, 320, 200)'));
  });
});

describe('given two buttons bound to different actions', () => {
  it('when generating, then each tag (the widget index) dispatches to its own action', () => {
    const spec = hello();
    spec.widgets.push({ type: 'button', id: 'reset', text: 'Reset', x: 140, y: 60, width: 100, height: 28, action: 'reset' });
    const source = generateMacosUi(spec);
    assert.ok(source.includes('case 1:\n      action_greet(g_surface);'));
    assert.ok(source.includes('case 2:\n      action_reset(g_surface);'));
    assert.ok(source.includes('[w_reset setTag:2];'));
  });
});

describe('given a window title with quotes', () => {
  it('when generating, then the title is emitted as an escaped Objective-C literal', () => {
    const spec = hello();
    spec.window.title = 'Say "hi"';
    assert.ok(generateMacosUi(spec).includes('[window setTitle:@"Say \\"hi\\""];'));
  });
});
