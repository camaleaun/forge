import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildProjectIr } from '../../src/project/build.ts';

const fixture = new URL('../fixtures/steps-app', import.meta.url).pathname;
const goldenFile = new URL('../golden/ir-steps/steps.ir.json', import.meta.url).pathname;

async function buildWith(edit: (app: string) => string, css?: string) {
  const dir = mkdtempSync(join(tmpdir(), 'forge-steps-'));
  try {
    cpSync(fixture, dir, { recursive: true });
    writeFileSync(join(dir, 'App.tsx'), edit(readFileSync(join(dir, 'App.tsx'), 'utf8')));
    if (css !== undefined) writeFileSync(join(dir, 'App.css'), css);
    return await buildProjectIr(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('given the steps-app fixture (language screen and hello screen)', () => {
  it('when building the project IR, then it matches the golden IR', async (t) => {
    const { ir, errors } = await buildProjectIr(fixture);
    assert.deepEqual(errors, []);
    t.assert.fileSnapshot(JSON.stringify(ir, null, 2) + '\n', goldenFile, { serializers: [(value: unknown) => value as string] });
  });

  it('when reading the IR, then the screens, sizes, navigation and download-aware button are there', async () => {
    const { ir } = await buildProjectIr(fixture);
    const [steps] = ir!.root.children;
    assert.deepEqual(steps.children.map((s) => [s.id, s.step]), [['language', { width: 420, height: 180 }], ['hello', { width: 600, height: 440 }]]);
    assert.deepEqual(ir!.handlers.find((h) => h.id === 'confirm')!.effects.map((e) => e.op), ['set', 'go']);
    assert.deepEqual(ir!.handlers.map((h) => h.id).sort(), ['back', 'confirm', 'greet', 'handler_4', 'quit']);
  });
});

describe('given mistakes in a steps app', () => {
  const line = (app: string, text: string) => app.split('\n').findIndex((l) => l.includes(text)) + 1;

  it('when goTo names a missing step, then the error points at the button in App.tsx', async () => {
    let at = 0;
    const { errors } = await buildWith((app) => { at = line(app, "goTo('language')"); return app.replace("goTo('language')", "goTo('nowhere')"); });
    assert.deepEqual(errors, [`App.tsx:${at}:13: goTo("nowhere"): there is no <step id="nowhere">`]);
  });

  it('when a step has no id, then the error points at the step', async () => {
    const { errors } = await buildWith((app) => app.replace('<step id="hello"', '<step'));
    assert.match(errors[0], /^App\.tsx:\d+:9: <step> needs an id/);
  });

  it('when a step sets its size in CSS, then the error points into App.css', async () => {
    const { errors } = await buildWith((app) => app, 'step { width: 300px }\n');
    // One error per step that the rule matches.
    const message = 'App.css:1:8: "width" cannot be set on <step>: the size of a step comes from its width and height attributes';
    assert.deepEqual(errors, [message, message]);
  });
});
