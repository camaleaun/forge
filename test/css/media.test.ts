import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCss } from '../../src/css/parse.ts';
import { resolveStyle } from '../../src/css/resolve.ts';

const resolve = (css: string, kind: 'window' | 'view' | 'text' | 'button' | 'progress', element: { classes: string[]; id?: string }) => {
  const parsed = parseCss(css, 'App.css');
  assert.deepEqual(parsed.errors, []);
  return resolveStyle(kind, element, parsed.rules, 'App.css');
};
const query = (maxWidth: number) => ({ maxWidth });

describe('given @media rules', () => {
  it('when a type rule has an @media variant, then the base style is untouched and the variant holds only what it sets', () => {
    const { style, variants, errors } = resolve('view { gap: 1px }\n@media (max-width: 500px) { view { gap: 2px; padding: 4px } }', 'view', { classes: [] });
    assert.deepEqual(errors, []);
    assert.deepEqual(style, { gap: 1 });
    assert.deepEqual(variants, [{ query: query(500), style: { gap: 2, padding: [4, 4, 4, 4] } }]);
  });
  it('when an element has no @media rule, then variants is empty', () => {
    assert.deepEqual(resolve('view { gap: 1px }', 'view', { classes: [] }).variants, []);
  });
  it('when several @media rules match, then the variants keep cascade order: specificity first, then source order', () => {
    const css = '.card { background: #fff }\n@media (max-width: 300px) { .card { gap: 3px } }\n@media (max-width: 500px) { view { gap: 5px } }\n@media (max-width: 400px) { view { padding: 1px } }';
    const { variants } = resolve(css, 'view', { classes: ['card'] });
    assert.deepEqual(variants.map((v) => v.query), [query(500), query(400), query(300)]);
  });
  it('when a base rule wins the cascade over an @media rule, then that declaration is left out of the variant', () => {
    const { variants } = resolve('@media (max-width: 500px) { view { gap: 2px; padding: 1px } }\n.card { gap: 3px }', 'view', { classes: ['card'] });
    assert.deepEqual(variants, [{ query: query(500), style: { padding: [1, 1, 1, 1] } }]);
  });
  it('when a later base rule of the same specificity wins, then the variant is dropped entirely', () => {
    assert.deepEqual(resolve('@media (max-width: 500px) { view { gap: 2px } }\nview { gap: 1px }', 'view', { classes: [] }).variants, []);
  });
  it('when the @media rule comes after the base rule of the same specificity, then it wins while the query matches', () => {
    const { style, variants } = resolve('view { gap: 1px }\n@media (max-width: 500px) { view { gap: 2px } }', 'view', { classes: [] });
    assert.deepEqual(style, { gap: 1 });
    assert.deepEqual(variants, [{ query: query(500), style: { gap: 2 } }]);
  });
  it('when two neighbouring @media rules have the same query, then they merge into one variant', () => {
    const css = '@media (max-width: 500px) { view { gap: 2px } }\n@media (max-width: 500px) { view { padding: 1px } }';
    assert.deepEqual(resolve(css, 'view', { classes: [] }).variants, [{ query: query(500), style: { gap: 2, padding: [1, 1, 1, 1] } }]);
  });
  it('when a property does not apply to the kind, then the error is the same as outside @media', () => {
    const { errors } = resolve('@media (max-width: 500px) {\n  text { gap: 2px }\n}', 'text', { classes: [] });
    assert.deepEqual(errors, ['App.css:2:10: "gap" is not supported on <text> in v1']);
  });
  it('when the window changes its own size in @media, then it is an error: @media measures that size', () => {
    const { errors } = resolve('@media (max-width: 500px) {\n  window { width: 200px; height: 100px; gap: 2px }\n}', 'window', { classes: [] });
    assert.deepEqual(errors, [
      'App.css:2:12: "width" on <window> cannot change with @media: the window size is what @media measures',
      'App.css:2:26: "height" on <window> cannot change with @media: the window size is what @media measures',
    ]);
  });
});
