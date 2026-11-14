import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderErrorPage, renderPage } from '../../src/dev/render.ts';
import { helloIr } from './helpers.ts';

describe('given the hello IR', () => {
  const html = renderPage(helloIr());

  it('when rendering then it is a single self-contained HTML document', () => {
    assert.match(html, /^<!doctype html>/i);
    assert.doesNotMatch(html, /<link\b|<script[^>]+\bsrc=/i);
  });
  it('when rendering then the window title is the document title', () => {
    assert.match(html, /<title>Hello, forge<\/title>/);
  });
  it('when rendering then the bound text shows the state initial text with data-state', () => {
    assert.match(html, /<div[^>]*data-state="s0"[^>]*>Press the button<\/div>/);
  });
  it('when rendering then the button is a <button> with its label and click handler', () => {
    assert.match(html, /<button[^>]*data-click="greet"[^>]*>Greet<\/button>/);
  });
  it('when rendering then the root fills the whole page: full width, at least the viewport height, border-box, and no fixed window size', () => {
    const root = html.match(/<div id="window_0"[^>]*style="([^"]*)"/)![1];
    assert.match(root, /(^|;)width:100%(;|$)/);
    assert.match(root, /(^|;)min-height:100vh(;|$)/);
    assert.match(root, /box-sizing:border-box/);
    assert.doesNotMatch(root, /320px|(^|;)height:/);
  });
  it('when rendering then there is no fixed-size card and the body has no margin or padding', () => {
    assert.doesNotMatch(html, /class="card"|\.card\{|fit-content/);
    assert.match(html, /body\{margin:0;padding:0;/);
  });
  it('when rendering then the CLI panel comes after the app, outside of it', () => {
    const tools = html.indexOf('<div id="forge-tools">');
    assert.ok(tools > html.indexOf('id="window_0"'));
    assert.equal(html.slice(tools - 6, tools), '</div>', 'the app root is closed before the tools');
    assert.ok(html.indexOf('id="forge-cli"') > tools);
  });
  it('when rendering then the window maps padding, gap and alignment to flexbox CSS', () => {
    assert.match(html, /padding:20px 20px 20px 20px/);
    assert.match(html, /gap:12px/);
    assert.match(html, /display:flex/);
    assert.match(html, /align-items:flex-start/);
  });
  it('when rendering then text style maps font size and #rrggbbaa colour to CSS', () => {
    assert.match(html, /font-size:15px/);
    assert.match(html, /color:#222222ff/);
  });
  it('when rendering then the button width is applied', () => {
    assert.match(html, /<button[^>]*style="[^"]*width:100px/);
  });
  it('when rendering then the CLI panel lists each command with flag and description', () => {
    assert.match(html, /<button[^>]*data-command="--greet"[^>]*>/);
    assert.match(html, /--greet/);
    assert.match(html, /Print the greeting/);
  });
  it('when rendering then the IR is embedded as JSON and subscribes to /events', () => {
    assert.match(html, /<script type="application\/json" id="forge-ir">/);
    assert.match(html, /EventSource\('\/events'\)/);
  });
});

describe('given user text with markup', () => {
  it('when a text literal contains <script> then it is escaped everywhere', () => {
    const ir = helloIr();
    ir.root.children[1].content = { kind: 'literal', value: '<script>alert(1)</script>' };
    const html = renderPage(ir);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.equal(html.split('<script>alert(1)').length, 1);
  });
  it('when the title has quotes and ampersands then they are escaped', () => {
    const ir = helloIr();
    ir.root.title = { kind: 'literal', value: 'A "quoted" & <b>' };
    const html = renderPage(ir);
    assert.match(html, /<title>A &quot;quoted&quot; &amp; &lt;b&gt;<\/title>/);
  });
  it('when a state initial text and an id contain markup then both are escaped', () => {
    const ir = helloIr();
    ir.states[0].initial = { kind: 'literal', value: '<img src=x onerror=1>' };
    ir.root.children[0].id = 'x"><i>';
    const html = renderPage(ir);
    assert.doesNotMatch(html, /<img src=x/);
    assert.doesNotMatch(html, /<i>/);
  });
  it('when the IR contains < then the embedded JSON escapes it as \\u003c', () => {
    const ir = helloIr();
    ir.handlers[0].effects[0].value.value = '</script><b>';
    const html = renderPage(ir);
    const json = html.match(/<script type="application\/json" id="forge-ir">([\s\S]*?)<\/script>/)![1];
    assert.doesNotMatch(json, /</);
    assert.equal(JSON.parse(json).handlers[0].effects[0].value.value, '</script><b>');
  });
  it('when a style value tries to break out of the declaration then it is dropped', () => {
    const ir = helloIr();
    ir.root.children[0].style.color = 'red;position:fixed';
    const markup = renderPage(ir).replace(/<script[\s\S]*?<\/script>/g, '');
    assert.doesNotMatch(markup, /position:fixed/);
  });
});

describe('given compile errors', () => {
  const html = renderErrorPage(['App.tsx:3:11: expected </button> but found </text>', 'App.css:1:8: unknown property <x>']);
  it('when rendering then each file:L:C message is listed and escaped', () => {
    assert.match(html, /App\.tsx:3:11: expected &lt;\/button&gt; but found &lt;\/text&gt;/);
    assert.match(html, /App\.css:1:8: unknown property &lt;x&gt;/);
    assert.doesNotMatch(html, /<\/button>/);
  });
  it('when rendering then it reloads automatically through /events', () => {
    assert.match(html, /EventSource\('\/events'\)/);
  });
});

describe('given an IR with messages and available languages', () => {
  const msg = (text: string, extra: object = {}) => ({ kind: 'message' as const, text, ...extra });
  const irWithMessages = () => {
    const ir = helloIr();
    ir.root.title = msg('Hello, forge');
    ir.root.children[1].content = msg('Greet <b>');
    ir.commands[0].description = msg('Print the greeting');
    return ir;
  };
  const embedded = (html: string) =>
    JSON.parse(html.match(/<script type="application\/json" id="forge-ir">([\s\S]*?)<\/script>/)![1]);

  it('when there are no languages then there is no select', () => {
    assert.doesNotMatch(renderPage(irWithMessages()), /id="forge-lang"/);
    assert.doesNotMatch(renderPage(irWithMessages(), { languages: [] }), /<select/);
  });
  it('when there are languages then the select lists Auto, English and each endonym', () => {
    const html = renderPage(irWithMessages(), { languages: ['pt-BR', 'es'] });
    const select = html.match(/<select id="forge-lang"[^>]*>([\s\S]*?)<\/select>/)![1];
    assert.deepEqual(
      [...select.matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)].map((m) => [m[1], m[2]]),
      [['auto', 'Auto'], ['en', 'English'], ['pt-BR', 'Português (Brasil)'], ['es', 'Español']],
    );
  });
  it('when a tag has markup then the option is escaped', () => {
    const html = renderPage(irWithMessages(), { languages: ['x"><script>1</script>'] });
    assert.doesNotMatch(html, /<script>1<\/script>/);
  });
  it('when a node text is a message then its element carries data-msg-key pointing into the embedded table', () => {
    const html = renderPage(irWithMessages(), { languages: ['pt-BR'] });
    const key = html.match(/<button[^>]*data-msg-key="(\d+)"[^>]*>Greet &lt;b&gt;<\/button>/)![1];
    assert.deepEqual(embedded(html).texts[Number(key)], msg('Greet <b>'));
  });
  it('when a CLI description is a message then it is wrapped in an element with data-msg-key', () => {
    const html = renderPage(irWithMessages());
    const key = html.match(/<span data-msg-key="(\d+)">Print the greeting<\/span>/)![1];
    assert.equal(embedded(html).texts[Number(key)].text, 'Print the greeting');
  });
  it('when a text is a literal then it has no data-msg-key', () => {
    const html = renderPage(helloIr(), { languages: ['pt-BR'] }).replace(/<script[\s\S]*?<\/script>/g, '');
    assert.doesNotMatch(html, /data-msg-key/);
  });
  it('when embedding then the raw message objects and the languages are carried, not the English copy', () => {
    const data = embedded(renderPage(irWithMessages(), { languages: ['pt-BR'] }));
    assert.deepEqual(data.languages, ['pt-BR']);
    assert.equal(data.root.children[1].content.kind, 'message');
    assert.equal(data.root.title.kind, 'message');
  });
  it('when there are no languages then the embedded languages list is empty', () => {
    assert.deepEqual(embedded(renderPage(irWithMessages())).languages, []);
  });
  it('when the script inserts translated text then only through textContent, never innerHTML', () => {
    const script = renderPage(irWithMessages(), { languages: ['pt-BR'] }).match(/<script>([\s\S]*?)<\/script>/)![1];
    assert.doesNotMatch(script, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(/);
    assert.match(script, /textContent/);
  });
});

describe('given an IR with a <select language /> node', () => {
  const withSelect = () => {
    const ir = helloIr();
    ir.root.children.push({ kind: 'select', id: 'select_7', classes: ['lang'], select: { language: true }, style: { width: 160, fontSize: 14 }, children: [], loc: [1, 1] });
    return ir;
  };
  const markup = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, '');
  it('when rendering then the select is in place inside the app root with the node style and id forge-lang', () => {
    const html = markup(renderPage(withSelect(), { languages: ['pt-BR'] }));
    const card = html.match(/<div id="window_0"[\s\S]*<\/div>/)![0];
    assert.match(card, /<select id="forge-lang" class="lang" style="[^"]*width:160px[^"]*font-size:14px[^"]*">/);
  });
  it('when rendering then the options are English plus each language, with no Auto', () => {
    const html = markup(renderPage(withSelect(), { languages: ['pt-BR', 'es'] }));
    const select = html.match(/<select id="forge-lang"[^>]*>([\s\S]*?)<\/select>/)![1];
    assert.deepEqual(
      [...select.matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)].map((m) => [m[1], m[2]]),
      [['en', 'English'], ['pt-BR', 'Português (Brasil)'], ['es', 'Español']],
    );
    assert.doesNotMatch(html, /Auto/);
  });
  it('when there are no languages then the select still shows English only', () => {
    const html = markup(renderPage(withSelect()));
    assert.match(html, /<select id="forge-lang"[^>]*><option value="en">English<\/option><\/select>/);
  });
  it('when the IR has a select node then the standalone selector is not added', () => {
    const html = markup(renderPage(withSelect(), { languages: ['pt-BR'] }));
    assert.equal(html.split('id="forge-lang"').length, 2);
  });
  it('when there is no select node then the standalone selector keeps Auto and marks itself', () => {
    const html = markup(renderPage(helloIr(), { languages: ['pt-BR'] }));
    assert.match(html, /<select id="forge-lang" data-auto="1"[^>]*><option value="auto">Auto<\/option>/);
  });
});
