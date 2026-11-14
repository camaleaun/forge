import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderPage } from '../../src/dev/render.ts';
import type { Ir, Variant } from '../../src/ir/types.ts';
import { helloIr } from './helpers.ts';

// The preview is plain HTML: @media variants become real CSS @media blocks (selectors by node id), so the
// browser's viewport drives them. The base style is inline, hence the !important in the blocks.
const mediaBlock = (html: string) => html.match(/<style id="forge-media">([^<]*)<\/style>/)?.[1];

function withVariants(id: string, variants: Variant[]): Ir {
  const ir = helloIr();
  const node = id === 'window' ? ir.root : ir.root.children.find((child) => child.id === id)!;
  node.variants = variants;
  return ir;
}

describe('given nodes with @media variants', () => {
  it('when a node has one variant, then a real @media block targets it by id, over the inline base', () => {
    const ir = withVariants(helloIr().root.children[0].id, [{ query: { maxWidth: 500 }, style: { gap: 2 } }]);
    const id = ir.root.children[0].id;
    assert.equal(mediaBlock(renderPage(ir)), `@media (max-width:500px){#${id}{gap:2px!important}}`);
  });
  it('when the query has several bounds, then they are joined by and, and several variants keep their order', () => {
    const id = helloIr().root.children[0].id;
    const ir = withVariants(id, [
      { query: { minWidth: 300, maxWidth: 400 }, style: { padding: [1, 2, 3, 4], flexDirection: 'row' } },
      { query: { minHeight: 100, maxHeight: 200 }, style: { flex: 1, fontWeight: 700, color: '#ff0000ff' } },
    ]);
    assert.equal(
      mediaBlock(renderPage(ir)),
      `@media (min-width:300px) and (max-width:400px){#${id}{padding:1px 2px 3px 4px!important;flex-direction:row!important}}` +
        `@media (min-height:100px) and (max-height:200px){#${id}{flex:1!important;font-weight:700!important;color:#ff0000ff!important}}`,
    );
  });
  it('when the window has a variant, then its own size is still ignored but padding and gap follow the viewport', () => {
    const ir = withVariants('window', [{ query: { maxWidth: 400 }, style: { padding: [2, 2, 2, 2], gap: 1 } }]);
    assert.equal(mediaBlock(renderPage(ir)), `@media (max-width:400px){#${ir.root.id}{padding:2px 2px 2px 2px!important;gap:1px!important}}`);
  });
  it('when the node is the language <select>, then the block targets the id the preview gives that dropdown', () => {
    const ir = helloIr();
    ir.root.children.push({ kind: 'select', id: 'select_9', classes: [], select: { language: true }, style: {}, variants: [{ query: { maxWidth: 400 }, style: { width: 80 } }], children: [], loc: [1, 1] });
    assert.equal(mediaBlock(renderPage(ir, { languages: ['pt-BR'] })), '@media (max-width:400px){#forge-lang{width:80px!important}}');
  });
  it('when no node has a variant, then there is no media block', () => {
    assert.equal(mediaBlock(renderPage(helloIr())), undefined);
  });
  it('when a value is not safe CSS, then it is left out', () => {
    const id = helloIr().root.children[0].id;
    const ir = withVariants(id, [{ query: { maxWidth: 500 }, style: { color: 'red;}body{display:none' } }]);
    assert.equal(mediaBlock(renderPage(ir)), undefined);
  });
});
