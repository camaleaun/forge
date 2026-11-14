import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { renderPage } from '../../src/dev/render.ts';
import { buildProjectIr } from '../../src/project/build.ts';

const fixture = new URL('../fixtures/steps-app', import.meta.url).pathname;
const ir = (await buildProjectIr(fixture)).ir!;
const html = renderPage(ir, { languages: ['pt-BR'] });
const tag = (id: string) => html.match(new RegExp(`<[a-z]+ id="${id}"[^>]*>`))![0];

describe('given an app with steps in the preview', () => {
  it('when rendering, then every step is a flex box marked data-step, and only the first is visible', () => {
    assert.match(tag('language'), /data-step="language"/);
    assert.doesNotMatch(tag('language'), /hidden/);
    assert.match(tag('language'), /display:flex/);
    assert.match(tag('language'), /padding:16px/);
    assert.match(tag('hello'), /data-step="hello" hidden/);
  });

  it('when rendering, then the preview ignores the step sizes (it stays fluid)', () => {
    assert.doesNotMatch(tag('language'), /width:420|height:180/);
    assert.doesNotMatch(tag('hello'), /width:600|height:440/);
  });

  it('when rendering, then the button that waits for the download is marked and the rule that hides steps exists', () => {
    assert.match(html, /<button type="button" id="button_\d+"[^>]* data-click="confirm" data-waits-download/);
    assert.match(html, /\[data-step\]\[hidden\]\{display:none/);
  });

  it('when the app has no steps, then nothing about steps is rendered', async () => {
    const plain = await buildProjectIr(new URL('../fixtures/hello-app', import.meta.url).pathname);
    assert.doesNotMatch(renderPage(plain.ir!), /data-step="|id="forge-notice"/);
  });
});

type Attrs = Record<string, string>;
class El {
  attrs: Attrs;
  hidden = false;
  disabled = false;
  textContent = '';
  value: number | undefined;
  listeners: (() => void)[] = [];
  constructor(attrs: Attrs, hidden = false) {
    this.attrs = attrs;
    this.hidden = hidden;
  }
  getAttribute(name: string) { return this.attrs[name] ?? null; }
  removeAttribute(name: string) { if (name === 'value') this.value = undefined; }
  addEventListener(type: string, fn: () => void) { if (type === 'click') this.listeners.push(fn); }
  click() { this.listeners.forEach((fn) => fn()); }
}

function boot() {
  const json = html.match(/<script type="application\/json" id="forge-ir">([\s\S]*?)<\/script>/)![1];
  const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
  const steps = [new El({ 'data-step': 'language' }), new El({ 'data-step': 'hello' }, true)];
  const click = (handler: string, extra: Attrs = {}) => new El({ 'data-click': handler, ...extra });
  const ok = click('confirm', { 'data-waits-download': '' });
  const cancel = click('quit');
  const back = click('back');
  const language = click('handler_4');
  const greet = click('greet');
  const bar = new El({ 'data-source': 'language-download' }, true);
  const notice = new El({}, true);
  const label = new El({ 'data-state': 's0' });
  const everything = [...steps, ok, cancel, back, language, greet, bar, label];
  const select = { value: '', getAttribute: () => null, addEventListener() {} };
  const document = {
    title: '',
    getElementById: (id: string) => (id === 'forge-ir' ? { textContent: json } : id === 'forge-lang' ? select : id === 'forge-notice' ? notice : null),
    querySelectorAll: (sel: string) => {
      const m = sel.match(/^\[([\w-]+)(?:="(.*)")?\]$/)!;
      return everything.filter((el) => (m[2] === undefined ? m[1] in el.attrs : el.attrs[m[1]] === m[2]));
    },
  };
  let respond!: (r: unknown) => void;
  vm.runInNewContext(script, {
    document, JSON, TextDecoder,
    fetch: () => new Promise((resolve) => { respond = resolve; }),
    EventSource: class {},
    location: { reload() {}, search: '?lang=pt-BR' },
    navigator: { languages: ['en-US'] },
    localStorage: { getItem: () => null, setItem() {} },
  });
  const visible = () => steps.filter((s) => !s.hidden).map((s) => s.attrs['data-step']);
  const tick = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
  return { visible, ok, cancel, back, language, greet, label, notice, bar, tick, finishDownload: () => respond({ ok: true, text: () => Promise.resolve('') }) };
}

describe('given the preview script of a steps app', () => {
  it('when the page loads, then only the first step shows', () => {
    assert.deepEqual(boot().visible(), ['language']);
  });

  it('when a button that sets state and calls next is clicked, then the state changes and the next step shows', async () => {
    const page = boot();
    page.finishDownload();
    await page.tick();
    page.ok.click();
    assert.deepEqual(page.visible(), ['hello']);
    assert.equal(page.label.textContent, 'Language chosen');
  });

  it('when back is clicked on the second step, then the first shows again; going back from the first stays', async () => {
    const page = boot();
    page.finishDownload();
    await page.tick();
    page.back.click();
    assert.deepEqual(page.visible(), ['language']);
    page.ok.click();
    page.back.click();
    assert.deepEqual(page.visible(), ['language']);
  });

  it('when goTo names a step, then that step shows', async () => {
    const page = boot();
    page.finishDownload();
    await page.tick();
    page.ok.click();
    page.language.click();
    assert.deepEqual(page.visible(), ['language']);
  });

  it('when quit is clicked, then the first step shows and a notice appears; the next click hides it', async () => {
    const page = boot();
    page.finishDownload();
    await page.tick();
    page.ok.click();
    page.cancel.click();
    assert.deepEqual(page.visible(), ['language']);
    assert.equal(page.notice.hidden, false);
    assert.match(html, /<div id="forge-notice" hidden>The app would quit here/);
    page.ok.click();
    assert.equal(page.notice.hidden, true);
  });

  it('when a language pack is downloading, then the waitsForDownload button is disabled until it ends', async () => {
    const page = boot();
    assert.equal(page.bar.hidden, false);
    assert.equal(page.ok.disabled, true);
    assert.equal(page.cancel.disabled, false);
    page.finishDownload();
    await page.tick();
    assert.equal(page.ok.disabled, false);
  });
});
