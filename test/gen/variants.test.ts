import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { effective, layoutOf, queryCondition, varies } from '../../src/gen/layout.ts';
import { node } from './helpers.ts';

const row = node('view', 'v0', {
  style: { gap: 8, padding: [1, 2, 3, 4], width: 100 },
  variants: [
    { query: { maxWidth: 500 }, style: { gap: 4, flexDirection: 'row', padding: [5, 6, 7, 8], width: 'auto', flex: 1, color: '#112233ff', fontSize: 11, fontWeight: 700, textAlign: 'center', background: '#00000080', borderRadius: 3, height: 20 } },
    { query: { minWidth: 300, maxHeight: 400 }, style: { gap: 2 } },
  ],
  children: [node('text', 't0')],
});

describe('given a node with @media variants', () => {
  const layout = layoutOf(row);
  it('when laid out, then the base fields are unchanged and the variants carry only what they set, in layout terms', () => {
    assert.equal(layout.gap, 8);
    assert.equal(layout.width, 100);
    assert.deepEqual(layout.variants, [
      {
        query: { maxWidth: 500 },
        set: { gap: 4, horizontal: true, padding: [5, 6, 7, 8], width: -1, height: 20, grow: true, color: '#112233ff', fontSize: 11, fontWeight: 700, textAlign: 'center', background: '#00000080', radius: 3 },
      },
      { query: { minWidth: 300, maxHeight: 400 }, set: { gap: 2 } },
    ]);
  });
  it('when the node has no variants, then the field is absent', () => {
    assert.ok(!('variants' in layout.children[0]));
  });
  it('when asked what varies, then it says which keys some variant sets', () => {
    assert.equal(varies(layout, 'gap'), true);
    assert.equal(varies(layout, 'horizontal'), true);
    assert.equal(varies(layout.children[0], 'gap'), false);
  });
  it('when a query is turned into C++, then every bound is compared with the window size variables', () => {
    assert.equal(queryCondition({ maxWidth: 500 }, 'w', 'h'), 'w <= 500');
    assert.equal(queryCondition({ minWidth: 300, maxHeight: 400 }, 'w', 'h'), 'w >= 300 && h <= 400');
    assert.equal(queryCondition({ minWidth: 1, maxWidth: 2, minHeight: 3, maxHeight: 4 }, 'w', 'h'), 'w >= 1 && w <= 2 && h >= 3 && h <= 4');
  });
  it('when the effective value is built, then later variants override earlier ones and the base is the last resort', () => {
    assert.equal(effective(layout, 'gap', '8', (v) => String(v)), '(w >= 300 && h <= 400 ? 2 : (w <= 500 ? 4 : 8))');
  });
  it('when a key is set by no variant, then the effective value is just the base', () => {
    assert.equal(effective(layout.children[0], 'gap', '0', (v) => String(v)), '0');
  });
  it('when the width is read per variant, then auto is -1', () => {
    assert.equal(effective(layout, 'width', '100', (v) => String(v)), '(w <= 500 ? -1 : 100)');
  });
});
