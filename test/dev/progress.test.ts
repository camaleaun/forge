import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { renderPage } from '../../src/dev/render.ts';
import type { Ir, Node } from '../../src/ir/types.ts';
import { helloIr } from './helpers.ts';

const bar = (progress: Node['progress'], extra: Partial<Node> = {}): Node =>
  ({ kind: 'progress', id: 'progress_3', classes: ['dl'], progress, style: {}, children: [], loc: [1, 1], ...extra });

const withBar = (node: Node): Ir => {
  const ir = helloIr();
  ir.root.children.push(node);
  return ir;
};

const tagOf = (html: string) => html.match(/<progress [^>]*>/)![0];

describe('given a <progress> node in the preview', () => {
  it('when determinate, then it renders <progress> with value and max and the node style', () => {
    const tag = tagOf(renderPage(withBar(bar({ value: 0.25 }, { style: { width: 200, height: 8, color: '#00aa00ff', flex: 1 } }))));
    assert.equal(tag, '<progress id="progress_3" class="dl" value="0.25" max="1" style="width:200px;height:8px;color:#00aa00ff;flex:1">');
  });

  it('when max is set, then max is rendered', () => {
    assert.match(tagOf(renderPage(withBar(bar({ value: 5, max: 10 })))), /value="5" max="10"/);
  });

  it('when indeterminate, then there is no value attribute', () => {
    const tag = tagOf(renderPage(withBar(bar({ indeterminate: true }))));
    assert.doesNotMatch(tag, /value=/);
  });

  it('when bound to the language download, then it is hidden, marked for the script and has no value', () => {
    const tag = tagOf(renderPage(withBar(bar({ source: 'language-download' })), { languages: ['pt-BR'] }));
    assert.match(tag, / data-source="language-download"/);
    assert.match(tag, / hidden/);
    assert.doesNotMatch(tag, /value=/);
  });

  it('when hidden, then it takes no space even if the style gives it a display', () => {
    assert.match(renderPage(withBar(bar({}))), /progress\[hidden\]\{display:none\}/);
  });
});

type Bar = { hidden: boolean; value: number | undefined; removeAttribute(name: string): void };

// Runs the page script with one language-download bar and a controllable pack download.
function boot() {
  const html = renderPage(withBar(bar({ source: 'language-download' })), { languages: ['pt-BR'] });
  const json = html.match(/<script type="application\/json" id="forge-ir">([\s\S]*?)<\/script>/)![1];
  const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
  const progress: Bar = { hidden: true, value: undefined, removeAttribute(name) { if (name === 'value') this.value = undefined; } };
  const select = { value: '', getAttribute: () => null, addEventListener() {} };
  const document = {
    title: '',
    getElementById: (id: string) => (id === 'forge-ir' ? { textContent: json } : id === 'forge-lang' ? select : null),
    querySelectorAll: (sel: string) => (sel === '[data-source="language-download"]' ? [progress] : []),
  };
  const chunks: ((value: { done: boolean; value?: Uint8Array }) => void)[] = [];
  const reader = { read: () => new Promise<{ done: boolean; value?: Uint8Array }>((resolve) => chunks.push(resolve)) };
  let respond!: (r: unknown) => void;
  const fetch = () => new Promise((resolve) => { respond = resolve; });
  vm.runInNewContext(script, {
    document, fetch, JSON, TextDecoder,
    EventSource: class {},
    location: { reload() {}, search: '?lang=pt-BR' },
    navigator: { languages: ['en-US'] },
    localStorage: { getItem: () => null, setItem() {} },
  });
  const tick = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
  return { progress, reader, respond: (r: unknown) => respond(r), push: (...v: { done: boolean; value?: Uint8Array }[]) => v.forEach((x) => chunks.shift()!(x)), tick };
}

const PACK = new TextEncoder().encode('forge-lang 1\n');

describe('given the preview script and a slow language pack download', () => {
  it('when the fetch starts, then the bar shows (indeterminate until a total is known) and it hides when the pack arrives', async () => {
    const page = boot();
    assert.equal(page.progress.hidden, false);
    assert.equal(page.progress.value, undefined);
    page.respond({ ok: true, text: () => Promise.resolve('') });
    await page.tick();
    assert.equal(page.progress.hidden, true);
  });

  it('when Content-Length is known, then the value follows the bytes received and the bar hides at the end', async () => {
    const page = boot();
    page.respond({ ok: true, headers: { get: (n: string) => (n.toLowerCase() === 'content-length' ? String(PACK.length * 2) : null) }, body: { getReader: () => page.reader } });
    await page.tick();
    page.push({ done: false, value: PACK });
    await page.tick();
    assert.equal(page.progress.hidden, false);
    assert.equal(page.progress.value, 0.5);
    page.push({ done: false, value: PACK });
    await page.tick();
    assert.equal(page.progress.value, 1);
    page.push({ done: true });
    await page.tick();
    assert.equal(page.progress.hidden, true);
  });

  it('when the download fails, then the bar hides', async () => {
    const page = boot();
    page.respond({ ok: false, text: () => Promise.reject(new Error('x')) });
    await page.tick();
    assert.equal(page.progress.hidden, true);
  });
});
