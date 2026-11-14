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
  it('when rendering then the window card maps size, padding, gap and alignment to flexbox CSS', () => {
    assert.match(html, /width:320px/);
    assert.match(html, /height:120px/);
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
