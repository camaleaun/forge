import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseCss } from '../../src/css/parse.ts';

describe('given a single CSS rule', () => {
  it('when parsing `window { gap: 12px }`, then it yields one rule with selector and declaration positions', () => {
    const { rules, errors } = parseCss('window { gap: 12px }', 'App.css');
    assert.deepEqual(errors, []);
    assert.deepEqual(rules, [
      {
        selectors: [{ kind: 'type', name: 'window', loc: [1, 1] }],
        declarations: [{ property: 'gap', value: 12, loc: [1, 10] }],
        order: 0,
      },
    ]);
  });
});

describe('given a declaration with an unknown property', () => {
  it('when parsing `margin-top`, then the error has file:line:column and lists the supported properties', () => {
    const { rules, errors } = parseCss('window { margin-top: 4px }', 'App.css');
    assert.equal(errors.length, 1);
    assert.match(errors[0], /^App\.css:1:10: unknown property "margin-top" \(supported: .*gap.*\)$/);
    assert.deepEqual(rules[0].declarations, []);
  });
});

describe('given a declaration with an invalid value', () => {
  it('when padding is `2em`, then the error points at the value and says what was expected', () => {
    const { rules, errors } = parseCss('window {\n  padding: 2em;\n}', 'App.css');
    assert.deepEqual(errors, ['App.css:2:12: invalid value "2em" for "padding": expected px']);
    assert.deepEqual(rules[0].declarations, []);
  });
});

describe('given a padding shorthand', () => {
  const cases: [string, number[]][] = [
    ['8px', [8, 8, 8, 8]],
    ['8px 16px', [8, 16, 8, 16]],
    ['1px 2px 3px', [1, 2, 3, 2]],
    ['1px 2px 3px 4px', [1, 2, 3, 4]],
    ['0 10px', [0, 10, 0, 10]],
  ];
  for (const [input, expected] of cases) {
    it(`when padding is \`${input}\`, then it normalizes to [top, right, bottom, left] ${JSON.stringify(expected)}`, () => {
      const { rules, errors } = parseCss(`view { padding: ${input} }`, 'App.css');
      assert.deepEqual(errors, []);
      assert.deepEqual(rules[0].declarations[0].value, expected);
    });
  }

  it('when padding has five values, then it is an invalid value', () => {
    const { errors } = parseCss('view { padding: 1px 2px 3px 4px 5px }', 'App.css');
    assert.deepEqual(errors, ['App.css:1:17: invalid value "1px 2px 3px 4px 5px" for "padding": expected px']);
  });
});

describe('given comma-separated selectors and several rules', () => {
  it('when parsing `window, .card, #main {}` then `text {}`, then each selector has its kind and position and rules keep source order', () => {
    const source = 'window, .card,\n  #main { gap: 4px }\ntext { font-size: 14px }';
    const { rules, errors } = parseCss(source, 'App.css');
    assert.deepEqual(errors, []);
    assert.deepEqual(rules.map((r) => r.selectors), [
      [
        { kind: 'type', name: 'window', loc: [1, 1] },
        { kind: 'class', name: 'card', loc: [1, 9] },
        { kind: 'id', name: 'main', loc: [2, 3] },
      ],
      [{ kind: 'type', name: 'text', loc: [3, 1] }],
    ]);
    assert.deepEqual(rules.map((r) => r.order), [0, 1]);
    assert.deepEqual(rules[1].declarations, [{ property: 'font-size', value: 14, loc: [3, 8] }]);
  });
});

describe('given CSS with comments', () => {
  it('when comments appear between rules, inside selectors and declarations, then they are ignored and positions stay correct', () => {
    const source = '/* header\n   comment */\nwindow /* sel */ {\n  /* gap: 99px; */ gap: 12px; /* tail */\n}';
    const { rules, errors } = parseCss(source, 'App.css');
    assert.deepEqual(errors, []);
    assert.equal(rules.length, 1);
    assert.deepEqual(rules[0].selectors, [{ kind: 'type', name: 'window', loc: [3, 1] }]);
    assert.deepEqual(rules[0].declarations, [{ property: 'gap', value: 12, loc: [4, 20] }]);
  });

  it('when a declaration value contains a `;` or `}` inside a comment, then it does not end the declaration or rule', () => {
    const { rules, errors } = parseCss('view { gap: 4px /* ; } */ }', 'App.css');
    assert.deepEqual(errors, []);
    assert.deepEqual(rules[0].declarations.map((d) => d.value), [4]);
  });
});

describe('given selectors outside the v1 subset', () => {
  it('when the type selector is not an element kind, then it is an unknown element selector', () => {
    const { errors } = parseCss('div { gap: 4px }', 'App.css');
    assert.deepEqual(errors, ['App.css:1:1: unknown element selector "div"']);
  });

  it('when a selector uses a descendant combinator, then it is reported at its position', () => {
    const { errors } = parseCss('\nwindow text { gap: 4px }', 'App.css');
    assert.deepEqual(errors, ['App.css:2:1: unsupported selector "window text": combinators are not supported in v1']);
  });

  it('when a selector uses `>`, `+` or `~`, then it is a combinator error', () => {
    const { errors } = parseCss('view > text {}\nview + text {}\nview ~ text {}', 'App.css');
    assert.deepEqual(errors, [
      'App.css:1:1: unsupported selector "view > text": combinators are not supported in v1',
      'App.css:2:1: unsupported selector "view + text": combinators are not supported in v1',
      'App.css:3:1: unsupported selector "view ~ text": combinators are not supported in v1',
    ]);
  });

  it('when a selector uses a pseudo-class, then it is reported', () => {
    const { errors } = parseCss('button:hover { gap: 4px }', 'App.css');
    assert.deepEqual(errors, ['App.css:1:1: unsupported selector "button:hover": pseudo-classes are not supported in v1']);
  });

  it('when the second selector of a list is invalid, then its own position is reported', () => {
    const { errors } = parseCss('window, div {}', 'App.css');
    assert.deepEqual(errors, ['App.css:1:9: unknown element selector "div"']);
  });

  it('when a rule starts with an @-rule, then it is reported and the next rule still parses', () => {
    const { rules, errors } = parseCss('@foo (min-width: 600px) { window { gap: 4px } }\ntext { font-size: 14px }', 'App.css');
    assert.deepEqual(errors, ['App.css:1:1: unsupported at-rule "@foo" in v1']);
    assert.deepEqual(rules.map((r) => r.selectors[0]?.name), ['text']);
  });

  it('when a declaration uses !important, then it is reported at the value', () => {
    const { errors } = parseCss('window { gap: 4px !important }', 'App.css');
    assert.deepEqual(errors, ['App.css:1:15: "!important" is not supported in v1']);
  });
});

describe('given value grammars', () => {
  const valid: [string, string, number | string][] = [
    ['flex-direction', 'row', 'row'],
    ['flex-direction', 'column', 'column'],
    ['align-items', 'stretch', 'stretch'],
    ['justify-content', 'space-between', 'space-between'],
    ['width', '120px', 120],
    ['width', 'auto', 'auto'],
    ['height', '0', 0],
    ['flex', '2', 2],
    ['flex', '0.5', 0.5],
    ['border-radius', '6px', 6],
    ['font-size', '14px', 14],
    ['font-weight', 'normal', 400],
    ['font-weight', 'bold', 700],
    ['font-weight', '400', 400],
    ['font-weight', '700', 700],
    ['text-align', 'center', 'center'],
    ['background', '#fff', '#ffffffff'],
    ['background', '#1A2b3C', '#1a2b3cff'],
    ['color', '#11223344', '#11223344'],
    ['background', 'transparent', '#00000000'],
  ];
  for (const [property, input, expected] of valid) {
    const kind = property === 'color' || property === 'text-align' || property === 'font-size' || property === 'font-weight' ? 'text' : 'view';
    it(`when ${property} is \`${input}\`, then it normalizes to ${JSON.stringify(expected)}`, () => {
      const { rules, errors } = parseCss(`${kind} { ${property}: ${input} }`, 'App.css');
      assert.deepEqual(errors, []);
      assert.deepEqual(rules[0].declarations[0].value, expected);
    });
  }

  const invalid: [string, string, string][] = [
    ['gap', '10%', 'px'],
    ['gap', '1rem', 'px'],
    ['gap', '10', 'px'],
    ['flex-direction', 'diagonal', 'row | column'],
    ['align-items', 'baseline', 'start | center | end | stretch'],
    ['justify-content', 'stretch', 'start | center | end | space-between'],
    ['width', '50%', 'px | auto'],
    ['flex', '1px', 'number'],
    ['font-weight', '500', 'normal | bold | 400 | 700'],
    ['text-align', 'justify', 'left | center | right'],
    ['background', '#ff', 'color (#rgb, #rrggbb, #rrggbbaa or transparent)'],
    ['background', 'red', 'color (#rgb, #rrggbb, #rrggbbaa or transparent)'],
  ];
  for (const [property, input, expected] of invalid) {
    it(`when ${property} is \`${input}\`, then it is rejected expecting ${expected}`, () => {
      const kind = property === 'text-align' || property === 'font-weight' ? 'text' : 'view';
      const { errors } = parseCss(`${kind} { ${property}: ${input} }`, 'App.css');
      assert.equal(errors.length, 1);
      assert.match(errors[0], new RegExp(`^App\\.css:1:\\d+: invalid value "${input}" for "${property}": expected `));
      assert.ok(errors[0].endsWith(`expected ${expected}`), errors[0]);
    });
  }
});

describe('given a stylesheet with several problems', () => {
  it('when parsing it, then all errors are collected together in source order and valid declarations survive', () => {
    const source = [
      'div { gap: 4px }',
      'window {',
      '  margin-top: 4px;',
      '  padding: 2em;',
      '  gap: 8px;',
      '}',
      'button:hover {}',
      '@media print {}',
    ].join('\n');
    const { rules, errors } = parseCss(source, 'App.css');
    assert.equal(errors.length, 5);
    assert.deepEqual(errors.map((e) => e.split(': ')[0]), ['App.css:1:1', 'App.css:3:3', 'App.css:4:12', 'App.css:7:1', 'App.css:8:8']);
    const window = rules.find((r) => r.selectors.some((s) => s.name === 'window'));
    assert.deepEqual(window?.declarations, [{ property: 'gap', value: 8, loc: [5, 3] }]);
  });
});

describe('given malformed blocks', () => {
  it('when a rule is never closed, then an error points at its opening brace', () => {
    const { errors } = parseCss('window {\n  gap: 4px;\n', 'App.css');
    assert.deepEqual(errors, ['App.css:1:8: unclosed block, expected "}"']);
  });

  it('when a comment is never closed, then an error points at its start', () => {
    const { errors } = parseCss('window { gap: 4px }\n/* oops', 'App.css');
    assert.deepEqual(errors, ['App.css:2:1: unterminated comment']);
  });

  it('when a declaration has no colon, then an error points at it', () => {
    const { errors } = parseCss('window { gap 4px }', 'App.css');
    assert.deepEqual(errors, ['App.css:1:10: expected ":" in declaration "gap 4px"']);
  });
});

describe('given @only and @except blocks', () => {
  const css = '@only macos linux {\n  window { gap: 4px }\n  text { font-size: 14px }\n}\n@except web { button { font-size: 12px } }\nview { gap: 1px }';

  it('when parsing, then each nested rule carries its target condition and source order is kept', () => {
    const { rules, errors } = parseCss(css, 'App.css');
    assert.deepEqual(errors, []);
    assert.deepEqual(rules.map((r) => [r.selectors[0].name, r.conditions]), [
      ['window', [{ kind: 'target', mode: 'only', targets: ['macos', 'linux'] }]],
      ['text', [{ kind: 'target', mode: 'only', targets: ['macos', 'linux'] }]],
      ['button', [{ kind: 'target', mode: 'except', targets: ['web'] }]],
      ['view', undefined],
    ]);
    assert.deepEqual(rules.map((r) => r.order), [0, 1, 2, 3]);
    assert.deepEqual(rules[0].selectors[0].loc, [2, 3]);
    assert.deepEqual(rules[0].declarations, [{ property: 'gap', value: 4, loc: [2, 12] }]);
  });

  it('when @only has no targets, then it is reported at the at-rule', () => {
    assert.deepEqual(parseCss('@only { window { gap: 4px } }', 'App.css').errors, ['App.css:1:1: @only needs at least one target (macos | linux | windows | web | android | ios)']);
  });

  it('when a target is unknown, then it is reported at the name with the valid list', () => {
    assert.deepEqual(parseCss('@except macos beos { window { gap: 4px } }', 'App.css').errors,
      ['App.css:1:15: unknown target "beos" in @except (expected macos | linux | windows | web | android | ios)']);
  });

  it('when @only is nested in @only, then it is an error and the rest still parses', () => {
    const { rules, errors } = parseCss('@only macos {\n  @only linux { window { gap: 4px } }\n  text { font-size: 14px }\n}', 'App.css');
    assert.deepEqual(errors, ['App.css:2:3: @only cannot be nested inside @only']);
    assert.deepEqual(rules.map((r) => r.selectors[0].name), ['text']);
  });

  it('when @only has no block, then it is reported', () => {
    assert.deepEqual(parseCss('@only macos;', 'App.css').errors, ['App.css:1:1: @only needs a { ... } block']);
  });

  it('when the block is not closed, then it is reported', () => {
    assert.deepEqual(parseCss('@only macos { window { gap: 4px }', 'App.css').errors, ['App.css:1:13: unclosed block, expected "}"']);
  });
});

describe('given @media blocks', () => {
  const rulesOf = (css: string) => parseCss(css, 'App.css');
  it('when a rule sits in @media (min-width: 600px), then it carries that query as a condition', () => {
    const { rules, errors } = rulesOf('@media (min-width: 600px) { window { gap: 4px } }');
    assert.deepEqual(errors, []);
    assert.deepEqual(rules[0].conditions, [{ kind: 'media', query: { minWidth: 600 } }]);
    assert.deepEqual(rules[0].declarations.map((d) => d.property), ['gap']);
  });
  it('when conditions are joined by and, then every one of the four features is read', () => {
    const { rules, errors } = rulesOf('@media (min-width: 400px) and (max-width: 800px) and (min-height:100px) and ( max-height : 300px ) { text { font-size: 14px } }');
    assert.deepEqual(errors, []);
    assert.deepEqual(rules[0].conditions, [{ kind: 'media', query: { minWidth: 400, maxWidth: 800, minHeight: 100, maxHeight: 300 } }]);
  });
  it('when a block has several rules, then each keeps source order across and outside the @media', () => {
    const { rules } = rulesOf('window { gap: 1px }\n@media (max-width: 500px) {\n  window { gap: 2px }\n  text { font-size: 12px }\n}\ntext { font-size: 16px }');
    assert.deepEqual(rules.map((r) => r.order), [0, 1, 2, 3]);
    assert.deepEqual(rules.map((r) => r.conditions?.length ?? 0), [0, 1, 1, 0]);
  });
  it('when @media sits inside @only (or the other way round), then both conditions are kept in nesting order', () => {
    const inner = rulesOf('@only macos { @media (min-width: 300px) { window { gap: 2px } } }').rules[0];
    assert.deepEqual(inner.conditions, [{ kind: 'target', mode: 'only', targets: ['macos'] }, { kind: 'media', query: { minWidth: 300 } }]);
    const outer = rulesOf('@media (min-width: 300px) { @except web { window { gap: 2px } } }').rules[0];
    assert.deepEqual(outer.conditions, [{ kind: 'media', query: { minWidth: 300 } }, { kind: 'target', mode: 'except', targets: ['web'] }]);
  });
  const bad: [string, string, string][] = [
    ['a media type', '@media print { window { gap: 1px } }', 'App.css:1:8: unsupported media condition "print": only (min-width | max-width | min-height | max-height: <n>px), joined by "and", are supported'],
    ['another feature', '@media (orientation: landscape) { window { gap: 1px } }', 'App.css:1:8: unsupported media condition "(orientation: landscape)": only (min-width | max-width | min-height | max-height: <n>px), joined by "and", are supported'],
    ['or', '@media (min-width: 300px) or (max-width: 100px) { window { gap: 1px } }', 'App.css:1:8: unsupported media condition "(min-width: 300px) or (max-width: 100px)": only (min-width | max-width | min-height | max-height: <n>px), joined by "and", are supported'],
    ['em units', '@media (min-width: 40em) { window { gap: 1px } }', 'App.css:1:8: invalid value "40em" for "min-width": expected px'],
    ['a feature without a value', '@media (min-width) { window { gap: 1px } }', 'App.css:1:8: unsupported media condition "(min-width)": only (min-width | max-width | min-height | max-height: <n>px), joined by "and", are supported'],
    ['no condition', '@media { window { gap: 1px } }', 'App.css:1:1: @media needs a condition, e.g. @media (min-width: 600px)'],
    ['a repeated feature', '@media (min-width: 1px) and (min-width: 2px) { window { gap: 1px } }', 'App.css:1:29: "min-width" is given twice in one @media'],
    ['a nested @media', '@media (min-width: 1px) {\n  @media (max-width: 9px) { window { gap: 1px } }\n}', 'App.css:2:3: @media cannot be nested inside @media'],
    ['no block', '@media (min-width: 1px);', 'App.css:1:1: @media needs a { ... } block'],
  ];
  for (const [name, css, message] of bad) {
    it(`when the condition is ${name}, then the error is ${message.split(': ').slice(1).join(': ').slice(0, 40)}...`, () => {
      assert.deepEqual(rulesOf(css).errors, [message]);
    });
  }
  it('when justify-content or align-items is inside @media, then each is an error that explains why', () => {
    const { rules, errors } = rulesOf('@media (min-width: 1px) {\n  window { justify-content: center; align-items: start; gap: 2px }\n}');
    assert.deepEqual(errors, [
      'App.css:2:12: "justify-content" is not supported inside @media in v1: it changes how the widgets are built, so it cannot follow the window size (set it outside @media)',
      'App.css:2:37: "align-items" is not supported inside @media in v1: it changes how the widgets are built, so it cannot follow the window size (set it outside @media)',
    ]);
    assert.deepEqual(rules[0].declarations.map((d) => d.property), ['gap']);
  });
  it('when the same properties are outside @media, then they are fine', () => {
    assert.deepEqual(rulesOf('window { justify-content: center; align-items: start }').errors, []);
  });
  it('when the block is not closed, then it is reported', () => {
    assert.deepEqual(rulesOf('@media (min-width: 1px) { window { gap: 4px }').errors, ['App.css:1:25: unclosed block, expected "}"']);
  });
});
