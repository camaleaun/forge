import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildIr } from '../../src/ir/build.ts';
import { h } from '../../src/ir/runtime.ts';
import { applyStyles, parseStyles } from '../../src/project/styles.ts';

const css = `
view { gap: 1px }
@only macos { view { gap: 2px } }
@except macos { view { padding: 3px } }
@only linux web { view { height: 9px } }
`;

function styleFor(target: string) {
  const built = buildIr({ file: 'App.tsx', app: { name: 'a', version: '0.1.0' }, App: () => h('window', { 'forge:loc': [1, 1] }, h('view', {})), target });
  const parsed = parseStyles([{ file: 'App.css', source: css }]);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(applyStyles(built.ir!, parsed.rules, 'App.css', target), []);
  return built.ir!.root.children[0].style;
}

describe('given @only and @except rules', () => {
  it('when applying for macos, then @only macos wins over the base rule and @except macos is dropped', () => {
    assert.deepEqual(styleFor('macos'), { gap: 2 });
  });
  it('when applying for linux, then @except macos and @only linux apply', () => {
    assert.deepEqual(styleFor('linux'), { gap: 1, padding: [3, 3, 3, 3], height: 9 });
  });
  it('when applying for web, then @only linux web and @except macos apply', () => {
    assert.deepEqual(styleFor('web'), { gap: 1, padding: [3, 3, 3, 3], height: 9 });
  });
  it('when no target is given, then the preview target web is used', () => {
    const built = buildIr({ file: 'App.tsx', app: { name: 'a', version: '0.1.0' }, App: () => h('window', { 'forge:loc': [1, 1] }, h('view', {})) });
    const parsed = parseStyles([{ file: 'App.css', source: css }]);
    applyStyles(built.ir!, parsed.rules, 'App.css');
    assert.deepEqual(built.ir!.root.children[0].style, { gap: 1, padding: [3, 3, 3, 3], height: 9 });
  });
});

describe('given @media rules, combined with targets', () => {
  const mediaCss = `
view { gap: 1px }
@media (max-width: 500px) { view { gap: 2px } }
@only macos { @media (max-width: 300px) { view { padding: 5px } } }
@media (min-width: 900px) { @except macos { view { gap: 8px } } }
`;
  function nodeFor(target: string) {
    const built = buildIr({ file: 'App.tsx', app: { name: 'a', version: '0.1.0' }, App: () => h('window', { 'forge:loc': [1, 1] }, h('view', {}), h('text', {})), target });
    const parsed = parseStyles([{ file: 'App.css', source: mediaCss }]);
    assert.deepEqual(parsed.errors, []);
    assert.deepEqual(applyStyles(built.ir!, parsed.rules, 'App.css', target), []);
    return built.ir!.root.children;
  }
  it('when applying for macos, then the base stays in style and the matching variants follow in cascade order', () => {
    const [view] = nodeFor('macos');
    assert.deepEqual(view.style, { gap: 1 });
    assert.deepEqual(view.variants, [{ query: { maxWidth: 500 }, style: { gap: 2 } }, { query: { maxWidth: 300 }, style: { padding: [5, 5, 5, 5] } }]);
  });
  it('when applying for linux, then the @only macos variant is gone and the @except macos one is in', () => {
    const [view] = nodeFor('linux');
    assert.deepEqual(view.variants, [{ query: { maxWidth: 500 }, style: { gap: 2 } }, { query: { minWidth: 900 }, style: { gap: 8 } }]);
  });
  it('when an element matches no @media rule, then it has no variants field at all', () => {
    const [, text] = nodeFor('macos');
    assert.ok(!('variants' in text));
  });
});
