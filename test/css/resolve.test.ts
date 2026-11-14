import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCss } from '../../src/css/parse.ts';
import { resolveStyle } from '../../src/css/resolve.ts';

const resolve = (css: string, kind: 'window' | 'view' | 'text' | 'button' | 'progress', element: { classes: string[]; id?: string }) => {
  const parsed = parseCss(css, 'App.css');
  assert.deepEqual(parsed.errors, []);
  return resolveStyle(kind, element, parsed.rules, 'App.css');
};

describe('given a type rule', () => {
  it('when resolving a matching element, then the style holds only the properties that were set, normalized', () => {
    const { style, errors } = resolve('view { gap: 12px; padding: 8px 16px; background: #fff }', 'view', { classes: [] });
    assert.deepEqual(errors, []);
    assert.deepEqual(style, { gap: 12, padding: [8, 16, 8, 16], background: '#ffffffff' });
  });

  it('when resolving an element of another kind, then the rule does not apply', () => {
    const { style } = resolve('view { gap: 12px }', 'window', { classes: [] });
    assert.deepEqual(style, {});
  });
});

describe('given rules of different specificity', () => {
  const css = '#main { gap: 3px }\n.card { gap: 2px }\nview { gap: 1px }';
  it('when an element matches id, class and type rules, then the id rule wins regardless of source order', () => {
    assert.deepEqual(resolve(css, 'view', { classes: ['card'], id: 'main' }).style, { gap: 3 });
  });

  it('when an element matches class and type rules, then the class rule wins over a later type rule', () => {
    assert.deepEqual(resolve(css, 'view', { classes: ['card'] }).style, { gap: 2 });
  });

  it('when only the type rule matches, then it applies', () => {
    assert.deepEqual(resolve(css, 'view', { classes: ['other'], id: 'x' }).style, { gap: 1 });
  });

  it('when two rules have the same specificity, then the later one in the source wins', () => {
    assert.deepEqual(resolve('.a { gap: 1px }\n.b { gap: 2px }', 'view', { classes: ['b', 'a'] }).style, { gap: 2 });
    assert.deepEqual(resolve('.b { gap: 2px }\n.a { gap: 1px }', 'view', { classes: ['b', 'a'] }).style, { gap: 1 });
  });

  it('when rules set different properties, then they merge per property', () => {
    const merged = resolve('view { gap: 1px; padding: 4px }\n.card { gap: 9px }', 'view', { classes: ['card'] });
    assert.deepEqual(merged.style, { gap: 9, padding: [4, 4, 4, 4] });
  });

  it('when a comma list matches through its more specific selector, then that specificity is used', () => {
    const { style } = resolve('view, .card { gap: 2px }\n.other { gap: 5px }\nview { gap: 1px }', 'view', { classes: ['card', 'other'] });
    assert.deepEqual(style, { gap: 5 });
  });
});

describe('given a matching rule with a property the element kind does not support', () => {
  it('when a `button` rule sets background, then the error points at the declaration and the property is left out', () => {
    const css = 'button {\n  font-size: 14px;\n  background: #fff;\n}';
    const { style, errors } = resolve(css, 'button', { classes: [] });
    assert.deepEqual(errors, ['App.css:3:3: "background" is not supported on <button> in v1']);
    assert.deepEqual(style, { fontSize: 14 });
  });

  it('when a class rule sets padding and matches a text, then it is reported for text', () => {
    const { errors } = resolve('.box { padding: 4px }', 'text', { classes: ['box'] });
    assert.deepEqual(errors, ['App.css:1:8: "padding" is not supported on <text> in v1']);
  });

  it('when the rule does not match the element, then no error is reported', () => {
    const { errors } = resolve('.box { background: #fff }', 'button', { classes: [] });
    assert.deepEqual(errors, []);
  });

  it('when several unsupported declarations match, then all are reported', () => {
    const { errors } = resolve('button { background: #fff; gap: 1px }', 'button', { classes: [] });
    assert.deepEqual(errors, [
      'App.css:1:10: "background" is not supported on <button> in v1',
      'App.css:1:28: "gap" is not supported on <button> in v1',
    ]);
  });
});

describe('given CSS for the select element', () => {
  it('when a select has width, height and font size, then it resolves them', () => {
    const { rules, errors } = parseCss('select { width: 160px; height: 28px; font-size: 14px; }', 'App.css');
    assert.deepEqual(errors, []);
    assert.deepEqual(resolveStyle('select', { classes: [] }, rules, 'App.css').style, { width: 160, height: 28, fontSize: 14 });
  });

  it('when a select has a color, then it is reported as unsupported on <select> in v1', () => {
    const { rules } = parseCss('select { color: #ff0000; }', 'App.css');
    assert.deepEqual(resolveStyle('select', { classes: [] }, rules, 'App.css').errors,
      ['App.css:1:10: "color" is not supported on <select> in v1']);
  });
});

describe('given the progress element', () => {
  it('when a progress rule sets size and color, then they resolve', () => {
    const { style, errors } = resolve('progress { width: 200px; height: 8px; flex: 1; color: #0a0 }', 'progress', { classes: [] });
    assert.deepEqual(errors, []);
    assert.deepEqual(style, { width: 200, height: 8, flex: 1, color: '#00aa00ff' });
  });

  it('when a progress rule sets gap, then it is not supported on <progress>', () => {
    const { errors } = resolve('.bar { gap: 4px }', 'progress', { classes: ['bar'] });
    assert.deepEqual(errors, ['App.css:1:8: "gap" is not supported on <progress> in v1']);
  });
});
