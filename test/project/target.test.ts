import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildProjectIr } from '../../src/project/build.ts';

const fixture = new URL('../fixtures/hello-app', import.meta.url).pathname;

function withCopy(run: (dir: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), 'forge-target-'));
  cpSync(fixture, dir, { recursive: true });
  return run(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

const wrap = (dir: string) => {
  const source = readFileSync(join(dir, 'App.tsx'), 'utf8').replace('<button onClick={greet}>Greet</button>', '<only macos><button onClick={greet}>Greet</button></only>');
  writeFileSync(join(dir, 'App.tsx'), source);
};

describe('given an app with <only macos> around a button', () => {
  it('when building for macos, then the button is in the IR; for linux and by default (web) it is not', () =>
    withCopy(async (dir) => {
      wrap(dir);
      const kinds = async (target?: string) => (await buildProjectIr(dir, target)).ir?.root.children.map((c) => c.kind);
      assert.deepEqual(await kinds('macos'), ['text', 'button']);
      assert.deepEqual(await kinds('linux'), ['text']);
      assert.deepEqual(await kinds(), ['text']);
    }));

  it('when the target is unknown, then the error lists the valid names', () =>
    withCopy(async (dir) => {
      const { ir, errors } = await buildProjectIr(dir, 'beos');
      assert.equal(ir, undefined);
      assert.deepEqual(errors, ['unknown target "beos" (expected macos | linux | windows | web | android | ios)']);
    }));

  it('when the tag has a mistake, then the error carries App.tsx:line:column', () =>
    withCopy(async (dir) => {
      wrap(dir);
      writeFileSync(join(dir, 'App.tsx'), readFileSync(join(dir, 'App.tsx'), 'utf8').replace('<only macos>', '<only>'));
      const { errors } = await buildProjectIr(dir, 'macos');
      assert.match(errors[0], /^App\.tsx:\d+:\d+: <only> needs at least one target/);
    }));
});

describe('given App.css with @only macos', () => {
  it('when building for macos and linux, then only macos gets the rule; an unknown target in CSS carries App.css:line:column', () =>
    withCopy(async (dir) => {
      writeFileSync(join(dir, 'App.css'), '@only macos { text { font-size: 20px } }\n');
      assert.equal((await buildProjectIr(dir, 'macos')).ir?.root.children[0].style.fontSize, 20);
      assert.equal((await buildProjectIr(dir, 'linux')).ir?.root.children[0].style.fontSize, undefined);
      writeFileSync(join(dir, 'App.css'), '@only beos { text { font-size: 20px } }\n');
      assert.match((await buildProjectIr(dir, 'macos')).errors[0], /^App\.css:1:7: unknown target "beos" in @only/);
    }));
});
