import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCss } from '../../src/css/parse.ts';
import { resolveStyle } from '../../src/css/resolve.ts';

const resolve = (css: string, kind: 'step' | 'steps' | 'view') => {
  const parsed = parseCss(css, 'App.css');
  return { parsed, ...resolveStyle(kind, { classes: [] }, parsed.rules, 'App.css') };
};

describe('given a step selector', () => {
  it('when it sets the box properties of a view, then they apply to <step>', () => {
    const css = 'step { padding: 8px 16px; gap: 12px; background: #fff; flex-direction: row; align-items: center; justify-content: space-between }';
    const { parsed, style, errors } = resolve(css, 'step');
    assert.deepEqual([parsed.errors, errors], [[], []]);
    assert.deepEqual(style, { padding: [8, 16, 8, 16], gap: 12, background: '#ffffffff', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' });
  });

  it('when it sets width or height, then the error says the size comes from the attributes', () => {
    const { errors } = resolve('step { width: 300px }\nstep { height: 100px }', 'step');
    assert.deepEqual(errors, [
      'App.css:1:8: "width" cannot be set on <step>: the size of a step comes from its width and height attributes',
      'App.css:2:8: "height" cannot be set on <step>: the size of a step comes from its width and height attributes',
    ]);
  });

  it('when a view rule is used, then it does not apply to <step>', () => {
    assert.deepEqual(resolve('view { gap: 4px }', 'step').style, {});
  });
});

describe('given a steps selector', () => {
  it('when it sets any property, then the error says <steps> has no style of its own', () => {
    const { errors } = resolve('steps { gap: 4px }', 'steps');
    assert.deepEqual(errors, ['App.css:1:9: "gap" is not supported on <steps> in v1']);
  });
  it('when it has no declarations, then it is accepted', () => {
    assert.deepEqual(resolve('steps { }', 'steps').errors, []);
  });
});
