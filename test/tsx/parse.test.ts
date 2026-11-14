import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseElement } from '../../src/tsx/parse.ts';

describe('given a JSX element with text', () => {
  it('when parsing <text>Hello</text>, then it yields the element, its text child, its position and the end offset', () => {
    const source = '<text>Hello</text>';
    assert.deepEqual(parseElement(source, 0), {
      node: { name: 'text', attrs: [], children: [{ kind: 'text', value: 'Hello' }], loc: [1, 1] },
      end: source.length,
    });
  });
});

const el = (source: string, offset = 0) => parseElement(source, offset).node;

describe('given self-closing, fragment and nested elements', () => {
  it('when parsing <view />, then it has no children and ends after "/>"', () => {
    assert.deepEqual(parseElement('<view />', 0), {
      node: { name: 'view', attrs: [], children: [], loc: [1, 1] },
      end: 8,
    });
  });

  it('when parsing a fragment, then its name is empty', () => {
    const node = el('<><text>a</text></>');
    assert.equal(node.name, '');
    assert.equal(node.children.length, 1);
  });

  it('when elements are nested, then children contain element nodes', () => {
    const node = el('<view><text>a</text><button>b</button></view>');
    assert.deepEqual(
      node.children.map((c) => (c.kind === 'element' ? c.node.name : c.kind)),
      ['text', 'button'],
    );
  });

  it('when the element starts at an offset on line 3, then loc is 1-based [line, column] of the "<"', () => {
    const source = 'a\nb\n  <text />';
    assert.deepEqual(parseElement(source, source.indexOf('<')).node.loc, [3, 3]);
  });
});

describe('given text children', () => {
  const texts = (source: string) => el(source).children.map((c) => (c.kind === 'text' ? c.value : '?'));

  it('when the text spans lines, then lines are trimmed, blank lines dropped and joined by one space', () => {
    assert.deepEqual(texts('<text>\n   Hello\n\n   world  \n</text>'), ['Hello world']);
  });

  it('when the text is on one line, then inner spaces are kept', () => {
    assert.deepEqual(texts('<text> a  b </text>'), [' a  b ']);
  });

  it('when only whitespace with a line break lies between elements, then it is removed', () => {
    assert.equal(el('<view>\n  <text />\n  <text />\n</view>').children.length, 2);
  });

  it('when text sits beside an element on one line, then the space is preserved', () => {
    const node = el('<text>a <b>x</b> c</text>');
    assert.deepEqual(node.children[0], { kind: 'text', value: 'a ' });
    assert.deepEqual(node.children[2], { kind: 'text', value: ' c' });
  });
});

describe('given entities in text', () => {
  it('when text has named and numeric entities, then they are decoded', () => {
    const node = el('<text>&amp;&lt;&gt;&quot;&apos;&nbsp;&#65;&#x42;</text>');
    assert.deepEqual(node.children, [{ kind: 'text', value: '&<>"\' AB' }]);
  });
});

describe('given attributes', () => {
  it('when parsing class="m" onClick={() => go(\'}\')} disabled, then three attributes keep the expression intact', () => {
    const node = el(`<button class="m" onClick={() => go('}')} disabled />`);
    assert.deepEqual(node.attrs, [
      { name: 'class', value: { kind: 'string', value: 'm' }, loc: [1, 9] },
      { name: 'onClick', value: { kind: 'expr', code: `() => go('}')` }, loc: [1, 19] },
      { name: 'disabled', value: { kind: 'true' }, loc: [1, 43] },
    ]);
  });

  it('when a string attribute has entities, single quotes or a line break, then entities are decoded and the rest is kept', () => {
    const node = el(`<text a='x &amp; "y"' b="l1\nl2" />`);
    assert.deepEqual(node.attrs.map((a) => a.value), [
      { kind: 'string', value: 'x & "y"' },
      { kind: 'string', value: 'l1\nl2' },
    ]);
  });

  it('when an attribute name has a dash, then it is accepted', () => {
    assert.equal(el('<view data-id="1" />').attrs[0].name, 'data-id');
  });

  it('when attributes sit on several lines, then the element still parses', () => {
    const source = '<button\n  a="1"\n  b\n>x</button>';
    const parsed = parseElement(source, 0);
    assert.deepEqual(parsed.node.attrs.map((a) => [a.name, a.loc]), [['a', [2, 3]], ['b', [3, 3]]]);
    assert.equal(parsed.end, source.length);
  });
});

describe('given expression children', () => {
  it('when a child is {expr}, then the raw code is kept with the position of the "{"', () => {
    const node = el('<text>a {count + 1} b</text>');
    assert.deepEqual(node.children, [
      { kind: 'text', value: 'a ' },
      { kind: 'expr', code: 'count + 1', loc: [1, 9] },
      { kind: 'text', value: ' b' },
    ]);
  });

  it('when the expression contains JSX, then it stays raw code', () => {
    const node = el('<view>{items.map(i => <text>{i}</text>)}</view>');
    assert.deepEqual(node.children, [{ kind: 'expr', code: 'items.map(i => <text>{i}</text>)', loc: [1, 7] }]);
  });

  it('when the expression has strings, templates and comments with braces, then the scanner skips them', () => {
    const code = '`}${"}"}` /* } */ + \'}\'';
    assert.deepEqual(el(`<text>{${code}}</text>`).children, [{ kind: 'expr', code, loc: [1, 7] }]);
  });

  it('when a child is a {/* comment */} or {}, then it is dropped', () => {
    assert.deepEqual(el('<view>{/* note */}{ }<text />{ /* a */ /* b */ }</view>').children.length, 1);
  });
});

describe('given invalid JSX', () => {
  const fails = (source: string, pattern: RegExp, file = 'App.tsx') =>
    assert.throws(() => parseElement(source, source.indexOf('<'), file), pattern);

  it('when the closing tag does not match, then it reports expected </button> but found </text> at the closing tag', () => {
    fails('x\ny\n<button>Hi</text>', /^Error: App\.tsx:3:11: expected <\/button> but found <\/text>$/);
  });

  it('when a fragment is closed by a named tag, then it reports expected </> ', () => {
    fails('<><text></view>', /^Error: App\.tsx:1:9: expected <\/text> but found <\/view>$/);
    fails('<>a</view>', /^Error: App\.tsx:1:4: expected <\/> but found <\/view>$/);
  });

  it('when the element is never closed, then it reports the end position and where it was opened', () => {
    fails('a\nb\n  <view>\n  <text />\n', /^Error: App\.tsx:5:1: unterminated JSX element <view> opened at 3:3$/);
  });

  it('when a stray "}" is in the children, then it reports unexpected "}"', () => {
    fails('<text>a } b</text>', /^Error: App\.tsx:1:9: unexpected "\}"$/);
  });

  it('when an attribute is a spread, then it reports spread attributes are not supported', () => {
    fails('<view\n  {...props} />', /^Error: App\.tsx:2:3: spread attributes are not supported$/);
  });

  it('when the name is a member or namespace name, then it is rejected', () => {
    fails('<a.b />', /^Error: App\.tsx:1:2: member and namespace element names are not supported$/);
    fails('<a:b />', /^Error: App\.tsx:1:2: member and namespace element names are not supported$/);
  });

  it('when an attribute value is neither a string nor {expr}, then it reports the position', () => {
    fails('<view a=1 />', /^Error: App\.tsx:1:9: expected a string or {expression} as attribute value$/);
  });

  it('when an attribute string or a {expression} is unterminated, then the error points at the opener', () => {
    fails('<view a="x />', /^Error: App\.tsx:1:9: unterminated string$/);
    fails('<view a={x />', /^Error: App\.tsx:1:9: unbalanced "\{"$/);
    fails('<text>{x</text>', /^Error: App\.tsx:1:7: unbalanced "\{"$/);
  });

  it('when "<" is not followed by a name, then it reports expected an element name', () => {
    fails('<view>< 3</view>', /^Error: App\.tsx:1:8: expected an element name$/);
  });

  it('when no file is given, then the default file name is <input>', () => {
    assert.throws(() => parseElement('<a>', 0), /^Error: <input>:1:4: unterminated JSX element <a> opened at 1:1$/);
  });
});
