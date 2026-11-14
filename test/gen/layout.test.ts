import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { layoutOf } from '../../src/gen/layout.ts';
import { helloIr, node } from './helpers.ts';

describe('given the hello IR', () => {
  const root = layoutOf(helloIr().root);

  it('when laid out, then the root is a vertical box with gap, padding and a fixed size', () => {
    assert.equal(root.kind, 'box');
    assert.equal(root.horizontal, false);
    assert.equal(root.gap, 12);
    assert.deepEqual(root.padding, [20, 20, 20, 20]);
    assert.equal(root.width, 320);
    assert.equal(root.height, 120);
    assert.equal(root.align, 'start');
    assert.equal(root.justify, 'start');
  });

  it('when laid out, then the text carries its binding and paint, and the button its handler', () => {
    const [text, button] = root.children;
    assert.equal(text.kind, 'text');
    assert.deepEqual(text.content, { kind: 'state', state: 's0' });
    assert.equal(text.paint.fontSize, 15);
    assert.equal(text.paint.color, '#222222ff');
    assert.equal(button.kind, 'button');
    assert.equal(button.handler, 'greet');
    assert.equal(button.width, 100);
  });

  it('when the parent aligns to start, then children are not stretched across', () => {
    assert.equal(root.children[0].stretchInset, undefined);
  });
});

describe('given a container', () => {
  const view = (style: Record<string, string | number | number[]>, children = [node('text', 't0')]) =>
    layoutOf(node('view', 'v0', { style, children }));

  it('when flexDirection is row, then it is horizontal', () => {
    assert.equal(view({ flexDirection: 'row' }).horizontal, true);
  });
  it('when justifyContent is center, end or space-between, then justify says so; unknown values fall back to start', () => {
    assert.equal(view({ justifyContent: 'center' }).justify, 'center');
    assert.equal(view({ justifyContent: 'end' }).justify, 'end');
    assert.equal(view({ justifyContent: 'space-between' }).justify, 'space-between');
    assert.equal(view({ justifyContent: 'wat' }).justify, 'start');
  });
  it('when alignItems is absent, then it stretches; the child gets the cross inset of the padding', () => {
    const box = view({ padding: [1, 2, 3, 4] });
    assert.equal(box.align, 'stretch');
    assert.equal(box.children[0].stretchInset, 6, 'vertical box: left + right');
    const row = view({ flexDirection: 'row', padding: [1, 2, 3, 4] });
    assert.equal(row.children[0].stretchInset, 4, 'horizontal box: top + bottom');
  });
  it('when the child has its own cross size, then it is not stretched', () => {
    assert.equal(view({}, [node('text', 't0', { style: { width: 50 } })]).children[0].stretchInset, undefined);
    assert.equal(view({ flexDirection: 'row' }, [node('text', 't0', { style: { height: 50 } })]).children[0].stretchInset, undefined);
  });
  it('when a child has flex > 0, then it grows', () => {
    const box = view({}, [node('text', 't0', { style: { flex: 1 } }), node('text', 't1')]);
    assert.deepEqual(box.children.map((child) => child.grow), [true, false]);
  });
  it('when the node has a background and radius, then paint carries them', () => {
    const box = view({ background: '#ff0000ff', borderRadius: 8 });
    assert.equal(box.paint.background, '#ff0000ff');
    assert.equal(box.paint.radius, 8);
  });
});

describe('given a select', () => {
  it('when laid out, then it lists English plus the packs as language choices', () => {
    const select = layoutOf(node('select', 's0', { select: { language: true } }), [['en', 'English'], ['pt-BR', 'Português (Brasil)']]);
    assert.equal(select.kind, 'select');
    assert.deepEqual(select.languages, [['en', 'English'], ['pt-BR', 'Português (Brasil)']]);
  });
});
