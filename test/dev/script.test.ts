import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { renderPage } from '../../src/dev/render.ts';
import { helloIr } from './helpers.ts';

type Listener = () => void;
class El {
  attrs: Record<string, string>;
  textContent: string;
  listeners: Record<string, Listener[]> = {};
  constructor(attrs: Record<string, string>, text = '') {
    this.attrs = attrs;
    this.textContent = text;
  }
  getAttribute(name: string) {
    return this.attrs[name] ?? null;
  }
  addEventListener(type: string, fn: Listener) {
    (this.listeners[type] ??= []).push(fn);
  }
  click() {
    for (const fn of this.listeners.click ?? []) fn();
  }
}

/** Runs the page's inline app script against a tiny hand-written DOM built from the same page. */
function boot() {
  const html = renderPage(helloIr());
  const json = html.match(/<script type="application\/json" id="forge-ir">([\s\S]*?)<\/script>/)![1];
  const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
  const label = new El({ 'data-state': 's0' }, 'Press the button');
  const button = new El({ 'data-click': 'greet' }, 'Greet');
  const command = new El({ 'data-command': '--greet', 'data-handler': 'greet' }, '--greet');
  const out = new El({}, '');
  const all = [label, button, command];
  const sources: { url: string; onmessage?: (e: { data: string }) => void }[] = [];
  const reloads: number[] = [];
  const document = {
    getElementById: (id: string) => (id === 'forge-ir' ? { textContent: json } : id === 'forge-cli-out' ? out : null),
    querySelectorAll: (sel: string) => {
      const m = sel.match(/^\[([\w-]+)(?:="(.*)")?\]$/)!;
      return all.filter((el) => (m[2] === undefined ? m[1] in el.attrs : el.attrs[m[1]] === m[2]));
    },
  };
  class EventSource {
    url: string;
    onmessage?: (e: { data: string }) => void;
    constructor(url: string) {
      this.url = url;
      sources.push(this);
    }
  }
  vm.runInNewContext(script, { document, EventSource, location: { reload: () => reloads.push(1) }, JSON });
  return { label, button, command, out, sources, reloads };
}

describe('given the inline script of the hello page in a stubbed DOM', () => {
  it('when the button is clicked then the bound text becomes the handler value', () => {
    const { label, button } = boot();
    assert.equal(label.textContent, 'Press the button');
    button.click();
    assert.equal(label.textContent, 'Hello, world!');
  });
  it('when the CLI command is clicked then the state updates and the printed value is shown', () => {
    const { label, command, out } = boot();
    command.click();
    assert.equal(label.textContent, 'Hello, world!');
    assert.equal(out.textContent, '--greet: Hello, world!');
  });
  it('when the server sends reload on /events then the page reloads, other messages do not', () => {
    const { sources, reloads } = boot();
    assert.equal(sources[0].url, '/events');
    sources[0].onmessage!({ data: 'ping' });
    assert.equal(reloads.length, 0);
    sources[0].onmessage!({ data: 'reload' });
    assert.equal(reloads.length, 1);
  });
});
