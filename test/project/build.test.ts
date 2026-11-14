import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildProjectIr } from '../../src/project/build.ts';

const fixture = new URL('../fixtures/hello-app', import.meta.url).pathname;
const expected = JSON.parse(readFileSync(new URL('../fixtures/hello.ir.json', import.meta.url), 'utf8'));

// Source positions depend on the exact App.tsx layout; they are covered by the error tests.
function withoutLoc(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutLoc);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'loc').map(([key, v]) => [key, withoutLoc(v)]));
  }
  return value;
}

describe('given the hello app in TSX with its CSS', () => {
  it('when building the project IR, then it equals the expected hello IR and reports no errors', async () => {
    const { ir, errors } = await buildProjectIr(fixture);
    assert.deepEqual(errors, []);
    assert.deepEqual(withoutLoc(ir), withoutLoc(expected));
  });
});

function withCopy(run: (dir: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'forge-project-'));
  cpSync(fixture, dir, { recursive: true });
  return run(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

describe('given an app with mistakes', () => {
  it('when App.tsx has a JSX syntax error, then the error carries App.tsx:line:column', () =>
    withCopy(async (dir) => {
      const source = readFileSync(join(dir, 'App.tsx'), 'utf8').replace('</button>', '</text>');
      writeFileSync(join(dir, 'App.tsx'), source);
      const { ir, errors } = await buildProjectIr(dir);
      assert.equal(ir, undefined);
      assert.match(errors[0], /^App\.tsx:\d+:\d+: expected <\/button> but found <\/text>/);
    }));

  it('when App.css uses an unsupported property, then the error carries App.css:line:column', () =>
    withCopy(async (dir) => {
      writeFileSync(join(dir, 'App.css'), 'window { margin-top: 4px; }\n');
      const { ir, errors } = await buildProjectIr(dir);
      assert.equal(ir, undefined);
      assert.match(errors[0], /^App\.css:1:10: unknown property "margin-top"/);
    }));

  it('when a style is not supported on the element, then the error points at the declaration', () =>
    withCopy(async (dir) => {
      writeFileSync(join(dir, 'App.css'), 'button {\n  background: #ff0000;\n}\n');
      const { errors } = await buildProjectIr(dir);
      assert.deepEqual(errors, ['App.css:2:3: "background" is not supported on <button> in v1']);
    }));

  it('when the app reads a state value, then the build reports it', () =>
    withCopy(async (dir) => {
      const source = readFileSync(join(dir, 'App.tsx'), 'utf8').replace("message.set('Hello, world!');", 'message.set(`${message}!`);');
      writeFileSync(join(dir, 'App.tsx'), source);
      const { errors } = await buildProjectIr(dir);
      assert.deepEqual(errors, ['handler "greet": state values cannot be read in v1; bind the state as a child instead']);
    }));

  it('when package.json or App.tsx is missing, then the build says which file', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'forge-empty-'));
    try {
      assert.match((await buildProjectIr(empty)).errors[0], /^package\.json: cannot read it/);
      writeFileSync(join(empty, 'package.json'), JSON.stringify({ name: 'x', version: '0.1.0' }));
      assert.deepEqual((await buildProjectIr(empty)).errors, ['App.tsx: the app entry file was not found']);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('given an app edited between two builds', () => {
  it('when building twice after changing the text and the CSS, then the second IR reflects both changes', () =>
    withCopy(async (dir) => {
      const first = await buildProjectIr(dir);
      assert.deepEqual(first.ir?.states[0].initial, { kind: 'literal', value: 'Press the button' });
      writeFileSync(join(dir, 'App.tsx'), readFileSync(join(dir, 'App.tsx'), 'utf8').replace('Press the button', 'Go!'));
      writeFileSync(join(dir, 'App.css'), readFileSync(join(dir, 'App.css'), 'utf8').replace('width: 100px', 'width: 140px'));
      const second = await buildProjectIr(dir);
      assert.deepEqual(second.errors, []);
      assert.deepEqual(second.ir?.states[0].initial, { kind: 'literal', value: 'Go!' });
      assert.equal(second.ir?.root.children[1].style.width, 140);
    }));
});

const ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#f00"/></svg>';

describe('given an app with an icon.svg next to App.tsx', () => {
  it('when building the project IR, then the IR records the icon and the SVG source is returned for the build', () =>
    withCopy(async (dir) => {
      writeFileSync(join(dir, 'icon.svg'), ICON);
      const { ir, errors, iconSvg } = await buildProjectIr(dir);
      assert.deepEqual(errors, []);
      assert.equal(ir?.app.icon, 'AppIcon.icns');
      assert.equal(iconSvg, ICON);
    }));

  it('when there is no icon.svg, then the IR has no icon and no SVG is returned', async () => {
    const { ir, iconSvg } = await buildProjectIr(fixture);
    assert.equal(ir?.app.icon, undefined);
    assert.equal(iconSvg, undefined);
  });

  it('when icon.svg uses something the rasterizer does not support, then the build reports it with icon.svg:line:column', () =>
    withCopy(async (dir) => {
      writeFileSync(join(dir, 'icon.svg'), '<svg viewBox="0 0 10 10">\n  <text>hi</text>\n</svg>');
      const { ir, errors } = await buildProjectIr(dir);
      assert.equal(ir, undefined);
      assert.match(errors[0], /^icon\.svg:2:3: unsupported element <text>/);
    }));
});

describe('given an app that imports the translation functions from forge and has an i18n folder', () => {
  it('when building the project IR, then __() texts and the literal JSX text become messages', () =>
    withCopy(async (dir) => {
      const source = readFileSync(join(dir, 'App.tsx'), 'utf8')
        .replace("import { state } from 'forge';", "import { state, __ } from 'forge';")
        .replace("state('Press the button')", "state(__('Press the button'))");
      writeFileSync(join(dir, 'App.tsx'), source);
      mkdirSync(join(dir, 'i18n'));
      writeFileSync(join(dir, 'i18n/pt-BR.lang'), 'Press the button\tAperte o botão\n');
      const { ir, errors } = await buildProjectIr(dir);
      assert.deepEqual(errors, []);
      assert.deepEqual(ir?.states[0].initial, { kind: 'message', text: 'Press the button' });
      assert.deepEqual(ir?.root.children[1].content, { kind: 'message', text: 'Greet' });
      assert.deepEqual(ir?.root.title, { kind: 'message', text: 'Hello, forge' });
      assert.deepEqual(ir?.messages.map((m) => m.text), ['Greet', 'Hello, forge', 'Press the button']);
    }));

  it('when the project has no i18n folder, then the same __() still works and plain JSX text stays literal', () =>
    withCopy(async (dir) => {
      const source = readFileSync(join(dir, 'App.tsx'), 'utf8')
        .replace("import { state } from 'forge';", "import { state, __ } from 'forge';")
        .replace("state('Press the button')", "state(__('Press the button'))");
      writeFileSync(join(dir, 'App.tsx'), source);
      const { ir } = await buildProjectIr(dir);
      assert.deepEqual(ir?.root.children[1].content, { kind: 'literal', value: 'Greet' });
      assert.deepEqual(ir?.messages.map((m) => m.text), ['Press the button']);
    }));
});

describe('given a package.json with a repository and forge options', () => {
  it('when building the project IR, then the package fields the i18n build needs come back with it', async () => {
    await withCopy(async (dir) => {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      pkg.repository = 'github:o/r';
      pkg.forge = { i18n: { menu: false } };
      writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg));
      const result = await buildProjectIr(dir);
      assert.deepEqual(result.errors, []);
      assert.deepEqual(result.pkg, { name: 'hello', version: '0.1.0', repository: 'github:o/r', forge: { i18n: { menu: false } } });
    });
  });
});
