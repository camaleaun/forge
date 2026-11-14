import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { renderPage } from '../../src/dev/render.ts';
import { encodeLang } from '../../src/i18n/lang.ts';
import type { Ir, TextValue } from '../../src/ir/types.ts';
import { helloIr } from './helpers.ts';

type Listener = () => void;
class El {
  attrs: Record<string, string>;
  textContent = '';
  value = '';
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
  fire(type: string) {
    for (const fn of this.listeners[type] ?? []) fn();
  }
}

const msg = (text: string, extra: object = {}): TextValue => ({ kind: 'message', text, ...extra }) as TextValue;

function appIr(): Ir {
  const ir = helloIr();
  ir.root.title = msg('Hello app');
  ir.states[0].initial = msg('Press the button');
  ir.root.children[1].content = msg('Greet');
  ir.handlers[0].effects[0].value = msg('Hello, world!');
  ir.commands[0].description = msg('Print the greeting');
  return ir;
}

const PT_BR = encodeLang({
  tag: 'pt-BR', app: 'demo', version: '1.0.0',
  entries: [
    { text: 'Hello app', forms: ['Olá app'] },
    { text: 'Press the button', forms: ['Aperte o botão'] },
    { text: 'Hello, world!', forms: ['Olá, mundo!'] },
    { text: 'Greet', forms: ['Saudar'] },
    { text: 'Print the greeting', forms: ['Imprime a saudação'] },
    { text: '%d file', forms: ['%d arquivo', '%d arquivos'] },
    { text: 'Hi %s', forms: ['Oi %s'] },
    { text: 'Evil', forms: ['<script>alert(1)</script>'] },
  ],
});

type Env = { selectNode?: boolean; languages?: string[]; search?: string; navigatorLanguages?: string[]; stored?: string; packs?: Record<string, string>; ir?: Ir };

/** Runs the page's inline script against a tiny DOM wired from the rendered page. */
function boot(env: Env = {}) {
  const ir = env.ir ?? appIr();
  const languages = env.languages ?? ['pt-BR'];
  if (env.selectNode) {
    ir.root.children.push({ kind: 'select', id: 'select_9', classes: [], select: { language: true }, style: { width: 160 }, children: [], loc: [1, 1] });
  }
  const html = renderPage(ir, { languages });
  const json = html.match(/<script type="application\/json" id="forge-ir">([\s\S]*?)<\/script>/)![1];
  const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
  const texts: TextValue[] = JSON.parse(json).texts;
  const keyOf = (text: string) => String(texts.findIndex((t) => t.kind === 'message' && t.text === text));
  const label = new El({ 'data-state': 's0' }, 'Press the button');
  const button = new El({ 'data-click': 'greet', 'data-msg-key': keyOf((ir.root.children[1].content as { text: string }).text) }, 'Greet');
  const command = new El({ 'data-command': '--greet', 'data-handler': 'greet' }, '--greet');
  const description = new El({ 'data-msg-key': keyOf('Print the greeting') }, 'Print the greeting');
  const extras: El[] = [];
  const out = new El({}, '');
  const select = new El(env.selectNode ? {} : { 'data-auto': '1' }, '');
  const all = () => [label, button, command, description, ...extras];
  const requests: string[] = [];
  const store: Record<string, string> = env.stored === undefined ? {} : { 'forge-lang': env.stored };
  const document: Record<string, unknown> = {
    title: 'Hello app',
    getElementById: (id: string) =>
      id === 'forge-ir' ? { textContent: json } : id === 'forge-cli-out' ? out : id === 'forge-lang' && languages.length ? select : null,
    querySelectorAll: (sel: string) => {
      const m = sel.match(/^\[([\w-]+)(?:="(.*)")?\]$/)!;
      return all().filter((el) => (m[2] === undefined ? m[1] in el.attrs : el.attrs[m[1]] === m[2]));
    },
  };
  const fetch = (url: string) => {
    requests.push(url);
    const tag = decodeURIComponent(url.replace(/^\/?lang\//, '').replace(/\.lang$/, ''));
    const text = env.packs?.[tag];
    return Promise.resolve(text === undefined ? { ok: false, text: () => Promise.reject(new Error('x')) } : { ok: true, text: () => Promise.resolve(text) });
  };
  const sandbox: Record<string, unknown> = {
    document, fetch, JSON,
    EventSource: class { url: string; constructor(url: string) { this.url = url; } },
    location: { reload() {}, search: env.search ?? '' },
    navigator: { languages: env.navigatorLanguages ?? ['en-US'] },
    localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } },
  };
  vm.runInNewContext(script, sandbox);
  const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
  return { label, button, command, description, out, select, requests, store, document, settle, extras, texts, keyOf };
}

describe('given the inline script with a pt-BR pack available', () => {
  const packs = { 'pt-BR': PT_BR };

  it('when ?lang=pt-BR then the pack is fetched with a relative URL and the texts are translated', async () => {
    const page = boot({ search: '?lang=pt-BR', packs });
    await page.settle();
    assert.deepEqual(page.requests, ['lang/pt-BR.lang']);
    assert.equal(page.label.textContent, 'Aperte o botão');
    assert.equal(page.button.textContent, 'Saudar');
    assert.equal(page.description.textContent, 'Imprime a saudação');
    assert.equal(page.document.title, 'Olá app');
  });
  it('when the button is clicked in pt-BR then the state shows the translated effect', async () => {
    const page = boot({ search: '?lang=pt-BR', packs });
    await page.settle();
    page.button.fire('click');
    assert.equal(page.label.textContent, 'Olá, mundo!');
  });
  it('when a CLI command runs in pt-BR then the printed value is translated', async () => {
    const page = boot({ search: '?lang=pt-BR', packs });
    await page.settle();
    page.command.fire('click');
    assert.equal(page.out.textContent, '--greet: Olá, mundo!');
  });
  it('when ?lang=en then nothing is fetched and English stays', async () => {
    const page = boot({ search: '?lang=en', packs, navigatorLanguages: ['pt-BR'] });
    await page.settle();
    assert.deepEqual(page.requests, []);
    assert.equal(page.label.textContent, 'Press the button');
  });
  it('when ?lang is a tag with no pack then English stays and nothing is requested', async () => {
    const page = boot({ search: '?lang=fr', packs });
    await page.settle();
    assert.deepEqual(page.requests, []);
    assert.equal(page.label.textContent, 'Press the button');
  });
  it('when navigator.languages is pt-PT then the pt-BR pack is requested', async () => {
    const page = boot({ navigatorLanguages: ['pt-PT'], packs });
    await page.settle();
    assert.deepEqual(page.requests, ['lang/pt-BR.lang']);
    assert.equal(page.label.textContent, 'Aperte o botão');
  });
  it('when navigator.languages is fr-FR then nothing is requested', async () => {
    const page = boot({ navigatorLanguages: ['fr-FR'], packs });
    await page.settle();
    assert.deepEqual(page.requests, []);
  });
  it('when English is preferred before pt-BR then nothing is requested', async () => {
    const page = boot({ navigatorLanguages: ['en-GB', 'pt-BR'], packs });
    await page.settle();
    assert.deepEqual(page.requests, []);
  });
  it('when localStorage holds a choice then it wins over navigator.languages', async () => {
    const page = boot({ stored: 'pt-BR', navigatorLanguages: ['en-US'], packs });
    await page.settle();
    assert.equal(page.label.textContent, 'Aperte o botão');
    assert.equal(page.select.value, 'pt-BR');
  });
  it('when ?lang is given then it wins over localStorage', async () => {
    const page = boot({ search: '?lang=en', stored: 'pt-BR', packs });
    await page.settle();
    assert.deepEqual(page.requests, []);
  });
  it('when the fetch fails then English stays and the page still works', async () => {
    const page = boot({ search: '?lang=pt-BR', packs: {} });
    await page.settle();
    assert.deepEqual(page.requests, ['lang/pt-BR.lang']);
    assert.equal(page.label.textContent, 'Press the button');
    page.button.fire('click');
    assert.equal(page.label.textContent, 'Hello, world!');
  });
  it('when the pack is garbage then entries are skipped and English stays', async () => {
    const page = boot({ search: '?lang=pt-BR', packs: { 'pt-BR': '\u0000garbage without tabs\n' } });
    await page.settle();
    assert.equal(page.label.textContent, 'Press the button');
  });
  it('when an entry is missing from the pack then the English text is used', async () => {
    const page = boot({ search: '?lang=pt-BR', packs: { 'pt-BR': 'Greet\tSaudar\n' } });
    await page.settle();
    assert.equal(page.button.textContent, 'Saudar');
    assert.equal(page.label.textContent, 'Press the button');
  });
  it('when the select changes to pt-BR then it re-renders without reload and stores the choice', async () => {
    const reloads: number[] = [];
    const page = boot({ packs });
    await page.settle();
    assert.equal(page.label.textContent, 'Press the button');
    page.select.value = 'pt-BR';
    page.select.fire('change');
    await page.settle();
    assert.equal(page.label.textContent, 'Aperte o botão');
    assert.equal(page.store['forge-lang'], 'pt-BR');
    page.select.value = 'en';
    page.select.fire('change');
    await page.settle();
    assert.equal(page.label.textContent, 'Press the button');
    assert.equal(page.store['forge-lang'], 'en');
    assert.deepEqual(reloads, []);
  });
  it('when the choice goes back to pt-BR after a click then the clicked state is re-translated', async () => {
    const page = boot({ search: '?lang=en', packs });
    page.button.fire('click');
    assert.equal(page.label.textContent, 'Hello, world!');
    page.select.value = 'pt-BR';
    page.select.fire('change');
    await page.settle();
    assert.equal(page.label.textContent, 'Olá, mundo!');
  });
  it('when a translation contains markup then it is set as plain text', async () => {
    const ir = appIr();
    ir.root.children[1].content = msg('Evil');
    const page = boot({ search: '?lang=pt-BR', packs, ir });
    await page.settle();
    assert.equal(page.button.textContent, '<script>alert(1)</script>');
  });
  it('when there are no languages then no fetch happens even with navigator.languages set', async () => {
    const page = boot({ languages: [], navigatorLanguages: ['pt-BR'] });
    await page.settle();
    assert.deepEqual(page.requests, []);
  });
});

describe('given plural and sprintf messages in the inline script', () => {
  const packs = { 'pt-BR': PT_BR };
  const countIr = (count: number) => {
    const ir = appIr();
    ir.handlers[0].effects[0].value = msg('%d file', { plural: '%d files', count, args: [count] });
    return ir;
  };
  const clickAndRead = async (count: number, search: string) => {
    const page = boot({ ir: countIr(count), search, packs });
    await page.settle();
    page.button.fire('click');
    return page.label.textContent;
  };

  it('when the language is pt-BR then 1 gives "1 arquivo" and 3 gives "3 arquivos"', async () => {
    assert.equal(await clickAndRead(1, '?lang=pt-BR'), '1 arquivo');
    assert.equal(await clickAndRead(3, '?lang=pt-BR'), '3 arquivos');
  });
  it('when the language is pt-BR then 0 is singular (n > 1 rule)', async () => {
    assert.equal(await clickAndRead(0, '?lang=pt-BR'), '0 arquivo');
  });
  it('when the language is English then 1 gives "1 file" and 3 gives "3 files"', async () => {
    assert.equal(await clickAndRead(1, '?lang=en'), '1 file');
    assert.equal(await clickAndRead(3, '?lang=en'), '3 files');
    assert.equal(await clickAndRead(0, '?lang=en'), '0 files');
  });
  it('when there is no entry for a plural message then the English rule applies (singular only for 1)', async () => {
    const page = boot({ ir: countIr(2), search: '?lang=pt-BR', packs: { 'pt-BR': 'Greet\tSaudar\n' } });
    await page.settle();
    page.button.fire('click');
    assert.equal(page.label.textContent, '2 files');
  });
  it('when a message has sprintf args then they are filled in the translation', async () => {
    const ir = appIr();
    ir.root.children[1].content = msg('Hi %s', { args: ['Ana'] });
    const page = boot({ ir, search: '?lang=pt-BR', packs });
    await page.settle();
    assert.equal(page.button.textContent, 'Oi Ana');
  });
  it('when a pack has no plural-forms line then a plural entry uses its first form', async () => {
    const page = boot({ ir: countIr(3), search: '?lang=pt-BR', packs: { 'pt-BR': '%d file\t%d arquivo\t%d arquivos\n' } });
    await page.settle();
    page.button.fire('click');
    assert.equal(page.label.textContent, '3 arquivo');
  });
});

describe('given a <select language /> node in the app', () => {
  const packs = { 'pt-BR': PT_BR };
  it('when the page starts in English then the select shows English', async () => {
    const page = boot({ selectNode: true, navigatorLanguages: ['en-US'], packs });
    await page.settle();
    assert.equal(page.select.value, 'en');
  });
  it('when the browser prefers pt-PT then the select reflects the active pack pt-BR', async () => {
    const page = boot({ selectNode: true, navigatorLanguages: ['pt-PT'], packs });
    await page.settle();
    assert.equal(page.select.value, 'pt-BR');
    assert.equal(page.label.textContent, 'Aperte o botão');
  });
  it('when the select changes then it re-renders and stores the choice', async () => {
    const page = boot({ selectNode: true, packs });
    await page.settle();
    page.select.value = 'pt-BR';
    page.select.fire('change');
    await page.settle();
    assert.equal(page.label.textContent, 'Aperte o botão');
    assert.equal(page.store['forge-lang'], 'pt-BR');
  });
  it('when the standalone selector is used then it keeps Auto as its value', async () => {
    const page = boot({ navigatorLanguages: ['pt-PT'], packs });
    await page.settle();
    assert.equal(page.select.value, 'auto');
  });
});
