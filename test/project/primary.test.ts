import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildProjectIr } from '../../src/project/build.ts';
import { renderPage } from '../../src/dev/render.ts';

async function build(body: string) {
  const dir = mkdtempSync(join(tmpdir(), 'forge-primary-'));
  try {
    writeFileSync(join(dir, 'package.json'), '{"name":"p","version":"0.1.0","private":true,"type":"module"}');
    writeFileSync(join(dir, 'App.css'), '');
    writeFileSync(
      join(dir, 'App.tsx'),
      `import { next, back, quit } from 'forge';\nimport './App.css';\nexport default function App() {\n  return (\n<window title="t">\n${body}\n</window>\n  );\n}\n`,
    );
    return await buildProjectIr(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const TWO_SCREENS = `<steps>
  <step id="one"><button primary onClick={next}>OK</button><button cancel onClick={quit}>Cancel</button></step>
  <step id="two"><button primary onClick={back}>Back</button><button cancel onClick={quit}>Close</button></step>
</steps>`;

describe('given the primary and cancel attributes of a button', () => {
  it('when a step has one of each, then the IR marks the buttons', async () => {
    const { ir, errors } = await build(TWO_SCREENS);
    assert.deepEqual(errors, []);
    const [one] = ir!.root.children[0].children;
    assert.deepEqual(one.children.map((b) => [b.primary, b.cancel]), [[true, undefined], [undefined, true]]);
  });

  it('when a step has two primary buttons, then the second one is the error', async () => {
    const { errors } = await build('<steps><step id="a"><button primary>A</button><button primary>B</button></step></steps>');
    assert.match(errors[0], /^App\.tsx:\d+:\d+: a <step> can have only one primary button/);
  });

  it('when a window without steps has two cancel buttons, then the second one is the error', async () => {
    const { errors } = await build('<button cancel>A</button><view><button cancel>B</button></view>');
    assert.match(errors[0], /^App\.tsx:\d+:\d+: a <window> can have only one cancel button/);
  });

  it('when primary is used on a text or with a value, then it is an error', async () => {
    assert.match((await build('<text primary>A</text>')).errors[0], /primary is only supported on <button>/);
    assert.match((await build('<button cancel="yes">A</button>')).errors[0], /cancel is a bare attribute/);
  });
});

describe('given the preview of an app with a primary and a cancel button on each screen', () => {
  async function boot() {
    const html = renderPage((await build(TWO_SCREENS)).ir!);
    const json = html.match(/<script type="application\/json" id="forge-ir">([\s\S]*?)<\/script>/)![1];
    const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
    type El = { attrs: Record<string, string>; hidden: boolean; disabled: boolean; step?: El; fired: number; listeners: (() => void)[] };
    const el = (attrs: Record<string, string>, step?: El): El => ({ attrs, hidden: false, disabled: false, step, fired: 0, listeners: [] });
    const steps = [el({ 'data-step': 'one' }), el({ 'data-step': 'two' })];
    steps[1].hidden = true;
    const button = (click: string, extra: Record<string, string>, step: El) => el({ 'data-click': click, ...extra }, step);
    const [ok, cancel1] = [button('next', { 'data-primary': '' }, steps[0]), button('quit', { 'data-cancel': '' }, steps[0])];
    const [back, close] = [button('back', { 'data-primary': '' }, steps[1]), button('quit', { 'data-cancel': '' }, steps[1])];
    const buttons = [ok, cancel1, back, close];
    const everything = [...steps, ...buttons];
    for (const b of buttons) Object.assign(b, { closest: () => (b.step!.hidden ? b.step : null), click() { if (!b.disabled) b.listeners.forEach((fn) => fn()); } });
    const keys: ((event: unknown) => void)[] = [];
    const document = {
      title: '',
      addEventListener: (type: string, fn: (event: unknown) => void) => { if (type === 'keydown') keys.push(fn); },
      getElementById: (id: string) => (id === 'forge-ir' ? { textContent: json } : id === 'forge-notice' ? { hidden: true } : null),
      querySelectorAll: (sel: string) => {
        const m = sel.match(/^\[([\w-]+)(?:="(.*)")?\]$/)!;
        return everything.filter((e) => (m[2] === undefined ? m[1] in e.attrs : e.attrs[m[1]] === m[2]));
      },
    };
    for (const e of everything) Object.assign(e, { getAttribute: (n: string) => e.attrs[n] ?? null, addEventListener: (t: string, fn: () => void) => { if (t === 'click') e.listeners.push(fn); }, removeAttribute() {} });
    vm.runInNewContext(script, {
      document, JSON, TextDecoder,
      fetch: () => new Promise(() => {}),
      EventSource: class {},
      location: { reload() {}, search: '' },
      navigator: { languages: ['en-US'] },
      localStorage: { getItem: () => null, setItem() {} },
    });
    const press = (key: string, tag = 'BODY') => keys.forEach((fn) => fn({ key, target: { tagName: tag }, preventDefault() {} }));
    const shown = () => steps.filter((s) => !s.hidden).map((s) => s.attrs['data-step']);
    return { html, ok, back, press, shown };
  }

  it('when rendering, then the primary button has an accent style and both carry their marks', async () => {
    const { html } = await boot();
    assert.match(html, /<button type="button" id="button_\d+" data-click="next" data-primary>OK<\/button>/);
    assert.match(html, /data-cancel>Cancel<\/button>/);
    assert.match(html, /button\[data-primary\]\{[^}]*outline:2px solid/);
  });

  it('when Enter is pressed, then the primary button of the visible screen fires; after the switch the other one is the default', async () => {
    const page = await boot();
    page.press('Enter');
    assert.deepEqual(page.shown(), ['two']);
    page.press('Enter');
    assert.deepEqual(page.shown(), ['one']);
  });

  it('when the primary button is disabled, then Enter does nothing', async () => {
    const page = await boot();
    page.ok.disabled = true;
    page.press('Enter');
    assert.deepEqual(page.shown(), ['one']);
  });

  it('when Escape is pressed, then the cancel button fires (the preview returns to the first screen)', async () => {
    const page = await boot();
    page.press('Enter');
    page.press('Escape');
    assert.deepEqual(page.shown(), ['one']);
  });

  it('when Enter is pressed while a select or a text area has the focus, then it is ignored', async () => {
    const page = await boot();
    page.press('Enter', 'SELECT');
    page.press('Enter', 'TEXTAREA');
    assert.deepEqual(page.shown(), ['one']);
  });
});
