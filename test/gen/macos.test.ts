import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateMacosUi } from '../../src/gen/macos.ts';
import { golden, helloIr, node, serializers } from './helpers.ts';

describe('given the hello IR', () => {
  it('when generating the macOS UI, then it matches golden/ir-hello/ui_macos.mm', (t) => {
    t.assert.fileSnapshot(generateMacosUi(helloIr()), golden('ui_macos.mm'), { serializers });
  });
});

describe('given a root window without width and height', () => {
  it('when generating, then the content size defaults to 320x120', () => {
    const ir = helloIr();
    ir.root.style = {};
    assert.ok(generateMacosUi(ir).includes('NSMakeRect(0, 0, 320, 120)'));
  });
});

describe('given a window with flexDirection row', () => {
  const ir = helloIr();
  ir.root.style = { ...ir.root.style, flexDirection: 'row', alignItems: 'center' };
  const source = generateMacosUi(ir);

  it('when generating, then the stack is horizontal and aligned by centerY', () => {
    assert.ok(source.includes('[w_window_0 setOrientation:NSUserInterfaceLayoutOrientationHorizontal];'));
    assert.ok(source.includes('[w_window_0 setAlignment:NSLayoutAttributeCenterY];'));
  });
  it('when generating, then children join the leading gravity area', () => {
    assert.ok(source.includes('[w_window_0 addView:w_text_1 inGravity:NSStackViewGravityLeading];'));
  });
});

describe('given the alignItems and justifyContent values', () => {
  const generate = (style: Record<string, string | number | number[]>) => {
    const ir = helloIr();
    ir.root.style = { width: 320, height: 120, ...style };
    return generateMacosUi(ir);
  };

  it('when a column has alignItems end, then the alignment is trailing', () => {
    assert.ok(generate({ alignItems: 'end' }).includes('setAlignment:NSLayoutAttributeTrailing]'));
  });
  it('when a row has alignItems end, then the alignment is bottom', () => {
    assert.ok(generate({ flexDirection: 'row', alignItems: 'end' }).includes('setAlignment:NSLayoutAttributeBottom]'));
  });
  it('when alignItems is absent or stretch, then children are pinned to the cross axis with constraints', () => {
    const source = generate({ padding: [20, 20, 20, 20] });
    assert.ok(source.includes('[[w_text_1 widthAnchor] constraintEqualToAnchor:[w_window_0 widthAnchor] constant:-40] setActive:YES]'));
    assert.ok(source.includes('setAlignment:NSLayoutAttributeLeading]'));
  });
  it('when justifyContent is center, then children go into the center gravity area', () => {
    assert.ok(generate({ justifyContent: 'center', alignItems: 'start' }).includes('inGravity:NSStackViewGravityCenter]'));
  });
  it('when justifyContent is end in a column, then children go into the bottom gravity area', () => {
    assert.ok(generate({ justifyContent: 'end', alignItems: 'start' }).includes('inGravity:NSStackViewGravityBottom]'));
  });
  it('when justifyContent is space-between, then the distribution is equal spacing', () => {
    const source = generate({ justifyContent: 'space-between', alignItems: 'start' });
    assert.ok(source.includes('setDistribution:NSStackViewDistributionEqualSpacing]'));
    assert.ok(source.includes('[w_window_0 addArrangedSubview:w_text_1];'));
  });
});

describe('given a nested view with style, a flex child and a styled text', () => {
  const ir = helloIr();
  const label = node('text', 'label', {
    content: { kind: 'literal', value: 'Title' },
    style: { fontSize: 20, fontWeight: 700, color: '#ff000080', textAlign: 'center', flex: 1 },
  });
  const box = node('view', 'box', {
    style: { flexDirection: 'row', gap: 4, padding: [1, 2, 3, 4], background: '#00ff00ff', borderRadius: 8, width: 200, height: 50 },
    children: [label],
  });
  ir.root.children = [box];
  const source = generateMacosUi(ir);

  it('when generating, then the view is a nested stack with spacing, insets [t,l,b,r] and size constraints', () => {
    assert.ok(source.includes('NSStackView* w_box = [[NSStackView alloc] init];'));
    assert.ok(source.includes('[w_box setSpacing:4];'));
    assert.ok(source.includes('[w_box setEdgeInsets:NSEdgeInsetsMake(1, 4, 3, 2)];'));
    assert.ok(source.includes('[[[w_box widthAnchor] constraintEqualToConstant:200] setActive:YES];'));
    assert.ok(source.includes('[[[w_box heightAnchor] constraintEqualToConstant:50] setActive:YES];'));
    assert.ok(source.includes('[w_window_0 addView:w_box inGravity:NSStackViewGravityTop];'));
  });
  it('when generating, then background and borderRadius use a layer-backed view', () => {
    assert.ok(source.includes('[w_box setWantsLayer:YES];'));
    assert.ok(source.includes('[[w_box layer] setBackgroundColor:[[NSColor colorWithSRGBRed:0 green:1 blue:0 alpha:1] CGColor]];'));
    assert.ok(source.includes('[[w_box layer] setCornerRadius:8];'));
  });
  it('when generating, then the text applies size, weight, color and alignment', () => {
    assert.ok(source.includes('[w_label setFont:[NSFont systemFontOfSize:20 weight:NSFontWeightBold]];'));
    assert.ok(source.includes('alpha:0.502]];'));
    assert.ok(source.includes('[w_label setAlignment:NSTextAlignmentCenter];'));
  });
  it('when a child has flex, then it gets a low hugging priority along the main axis and the stack fills', () => {
    assert.ok(source.includes('[w_label setContentHuggingPriority:1 forOrientation:NSLayoutConstraintOrientationHorizontal];'));
    assert.ok(source.includes('[w_box setDistribution:NSStackViewDistributionFill];'));
  });
  it('when generating, then a literal text is fixed and not bound to a state', () => {
    assert.ok(source.includes('[w_label setStringValue:@"Title"];'));
    assert.ok(!source.includes('g_surface.bind'));
  });
});

describe('given two buttons bound to different handlers', () => {
  const ir = helloIr();
  ir.handlers.push({ id: 'reset', effects: [] });
  ir.root.children.push(node('button', 'button_3', { content: { kind: 'literal', value: 'Reset' }, on: { click: 'reset' } }));
  const source = generateMacosUi(ir);

  it('when generating, then each tag (index among buttons) dispatches to its own handler', () => {
    assert.ok(source.includes('case 0:\n      action_greet(g_surface);'));
    assert.ok(source.includes('case 1:\n      action_reset(g_surface);'));
    assert.ok(source.includes('[w_button_3 setTag:1];'));
  });
});

describe('given a button whose title is bound to a state', () => {
  it('when generating, then it starts with the initial text and is bound as a title', () => {
    const ir = helloIr();
    ir.states.push({ id: 's1', initial: { kind: 'literal', value: 'Go' } });
    ir.root.children.push(node('button', 'button_3', { content: { kind: 'state', state: 's1' } }));
    const source = generateMacosUi(ir);
    assert.ok(source.includes('[w_button_3 setTitle:@"Go"];'));
    assert.ok(source.includes('g_surface.bind(StateId::s1, w_button_3, true);'));
  });
});

describe('given quotes in the window title and in the texts', () => {
  const ir = helloIr();
  ir.root.title = { kind: 'literal', value: 'Say "hi"' };
  ir.states[0].initial = { kind: 'literal', value: 'He said "no"' };
  ir.app.name = 'my"app';
  const source = generateMacosUi(ir);

  it('when generating, then every string is an escaped Objective-C literal', () => {
    assert.ok(source.includes('[window setTitle:@"Say \\"hi\\""];'));
    assert.ok(source.includes('[w_text_1 setStringValue:@"He said \\"no\\""];'));
    assert.ok(source.includes('@"Quit my\\"app"'));
  });
});

describe('given a window with a width and a height in the CSS', () => {
  it('when generating, then the window can be resized, maximized and minimized, and never shrinks below that size', () => {
    const ir = helloIr();
    ir.root.style.width = 400;
    ir.root.style.height = 200;
    const source = generateMacosUi(ir);
    assert.ok(source.includes('NSWindowStyleMaskResizable'), 'resizable (this also enables the green maximize button)');
    assert.ok(source.includes('NSWindowStyleMaskMiniaturizable'));
    assert.ok(source.includes('[window setContentMinSize:NSMakeSize(400, 200)];'));
  });
});
