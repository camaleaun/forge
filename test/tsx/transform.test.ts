import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { transformJsx } from '../../src/tsx/transform.ts';

const IMPORT = 'import{h as __h,Fragment as __F}from"forge/jsx";';
const t = (source: string) => transformJsx(source, 'App.tsx');
// Output without the import prefix.
const body = (source: string) => {
  const out = t(source);
  assert.ok(out.startsWith(IMPORT), 'import prefix');
  return out.slice(IMPORT.length);
};
const lines = (s: string) => s.split('\n').length;

describe('given JSX in a TS source', () => {
  it('when transforming <text>{m}</text>, then it becomes an __h call with the loc and the same line count, import on the first line', () => {
    const source = 'export default () => <text>{m}</text>;\n';
    assert.equal(
      t(source),
      `${IMPORT}export default () => __h("text", {"forge:loc":[1,22]}, m);\n`,
    );
  });

  it('when the element is a component, then the name is an unquoted identifier', () => {
    assert.equal(body('x = <Box />'), 'x = __h(Box, {"forge:loc":[1,5]})');
  });

  it('when the element is a fragment, then it uses __F and null props', () => {
    assert.equal(body('x = <><text>a</text></>'), 'x = __h(__F, null, __h("text", {"forge:loc":[1,7]}, "a"))');
  });

  it('when attributes are string, expression and bare, then they become JSON string, raw code and true', () => {
    assert.equal(
      body(`x = <button class="m &amp; n" onClick={() => go('}')} disabled>Go</button>`),
      `x = __h("button", {"class":"m & n","onClick":() => go('}'),"disabled":true,"forge:loc":[1,5]}, "Go")`,
    );
  });

  it('when a text child needs escaping, then it is a JSON string', () => {
    assert.equal(body('x = <text>say "hi"\\</text>'), 'x = __h("text", {"forge:loc":[1,5]}, "say \\"hi\\"\\\\")');
  });

  it('when elements are nested, then the children are nested __h calls', () => {
    assert.equal(
      body('x = <view><text /></view>'),
      'x = __h("view", {"forge:loc":[1,5]}, __h("text", {"forge:loc":[1,11]}))',
    );
  });
});

describe('given JSX spanning several lines', () => {
  it('when the element has multi-line attributes, text and children, then every original newline is kept', () => {
    const source = [
      'const App = () => (',
      '  <view',
      '    a="x"',
      '    b={1 +',
      '      2}',
      '  >',
      '    <text>',
      '      Hello',
      '      world',
      '    </text>',
      '    {items}',
      '  </view>',
      ');',
    ].join('\n');
    const out = t(source);
    assert.equal(lines(out), lines(source));
    // the expression child stays on its original line
    assert.equal(out.split('\n').findIndex((l) => l.includes('items')), 10);
    assert.ok(out.includes('"Hello world"'));
  });

  it('when a return is followed by JSX that ends later, then no newline lands between return and the call', () => {
    const out = t('function f() {\n  return <view>\n    <text />\n  </view>;\n}');
    assert.match(out, /return __h\("view"/);
    assert.equal(lines(out), 5);
  });
});

describe('given code that only looks like JSX', () => {
  const same = (source: string) => assert.equal(t(source), IMPORT + source);

  it('when "<" is a comparison or a generic call, then it is untouched', () => {
    same('const ok = a < b && f<T>(x) > 1;');
    same('if (a <b) { c = d<e>(f) }');
  });

  it('when <text> is inside strings, templates, comments or regex, then it is untouched', () => {
    same(`const a = '<text>x</text>'; const b = "<text/>";`);
    same('const c = `<text>${1}</text>`;');
    same('// <text>x</text>\n/* <text/> */ const d = 1;');
    same('const r = /<text>/g; const s = x.replace(/<b>/, "");');
  });

  it('when a source has no JSX at all, then only the import is added', () => {
    same('export const n: number = 1;\n');
  });
});

describe('given JSX nested in expressions', () => {
  it('when an expression child maps to JSX, then the inner JSX is transformed too', () => {
    assert.equal(
      body('x = <view>{items.map(i => <text>{i}</text>)}</view>'),
      'x = __h("view", {"forge:loc":[1,5]}, items.map(i => __h("text", {"forge:loc":[1,27]}, i)))',
    );
  });

  it('when an attribute expression contains JSX, then it is transformed too', () => {
    assert.equal(
      body('x = <Box icon={<text />} />'),
      'x = __h(Box, {"icon":__h("text", {"forge:loc":[1,16]}),"forge:loc":[1,5]})',
    );
  });

  it('when a conditional renders JSX with && and ?:, then both are transformed', () => {
    const out = body('x = <view>{ok && <a />}{ok ? <b /> : <c />}</view>');
    assert.equal((out.match(/__h\(/g) ?? []).length, 4);
    assert.ok(!out.includes('<'));
  });
});

describe('given tricky TypeScript', () => {
  it('when an arrow is generic like <T,>(x: T) => x, then it is not treated as JSX', () => {
    const source = 'const id = <T,>(x: T) => x;\nconst e = <T extends object>(x: T) => x;';
    assert.equal(t(source), IMPORT + source);
  });

  it('when type annotations surround JSX, then they pass through', () => {
    assert.equal(
      body('const f = (p: Array<string>): Foo<number> => <text>{p[0] as string}</text>;'),
      'const f = (p: Array<string>): Foo<number> => __h("text", {"forge:loc":[1,46]}, p[0] as string);',
    );
  });
});

describe('given invalid JSX in a source', () => {
  it('when the JSX is broken, then the error is file:L:C: message with the original position', () => {
    assert.throws(() => t('\n\nx = <button>Hi</text>;'), /^Error: App\.tsx:3:15: expected <\/button> but found <\/text>$/);
  });

  it('when an attribute string is unterminated, then it reports unterminated string', () => {
    assert.throws(() => t('x = <view a="oops />;'), /^Error: App\.tsx:1:13: unterminated string$/);
  });

  it('when a "{" child is unbalanced, then it reports unbalanced "{"', () => {
    assert.throws(() => t('x = <text>{a</text>;'), /^Error: App\.tsx:1:11: unbalanced "\{"$/);
  });

  it('when JSX nested in an expression is broken, then the position is relative to the whole file', () => {
    assert.throws(
      () => t('x = <view>\n  {ok && <a>}</b>}\n</view>'),
      /^Error: App\.tsx:2:\d+: /,
    );
  });
});

describe('given the transformed output', () => {
  it('when evaluated with an __h that records calls, then it builds the expected tree (output is valid JS)', () => {
    const source = [
      'const items = [1, 2];',
      'const tree = (',
      '  <view id="v">',
      '    {items.map(i => <text key={i}>n {i}</text>)}',
      '    <>',
      '      <Box open />',
      '    </>',
      '  </view>',
      ');',
      'tree',
    ].join('\n');
    const js = t(source).replace(IMPORT, '');
    const h = (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => ({ type, props, children });
    const Box = () => null;
    const tree = new Function('__h', '__F', 'Box', `return eval(${JSON.stringify(js)})`)(h, 'F', Box);
    assert.equal(tree.type, 'view');
    assert.deepEqual(tree.props, { id: 'v', 'forge:loc': [3, 3] });
    assert.deepEqual(tree.children[0][1].children, ['n ', 2]);
    assert.equal(tree.children[1].type, 'F');
    assert.equal(tree.children[1].children[0].props.open, true);
    assert.equal(lines(js), lines(source));
  });
});

describe('given an empty attribute expression', () => {
  it('when an attribute is x={}, then it reports expected an expression at the "{"', () => {
    assert.throws(() => t('x = <view a={} />'), /^Error: App\.tsx:1:13: expected an expression$/);
    assert.throws(() => t('x = <view a={/* c */} />'), /^Error: App\.tsx:1:13: expected an expression$/);
  });
});
