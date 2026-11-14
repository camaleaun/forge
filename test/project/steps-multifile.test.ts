import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildProjectIr } from '../../src/project/build.ts';

const single = new URL('../fixtures/steps-app', import.meta.url).pathname;
const multi = new URL('../fixtures/steps-multifile', import.meta.url).pathname;

describe('given an app whose screens live in separate files (screens/Language.tsx, screens/Hello.tsx)', () => {
  it('when building, then every screen is a <step> of <steps> with its own size, state, handlers and CSS, and there are no errors', async () => {
    const { ir, errors } = await buildProjectIr(multi, 'web');
    assert.deepEqual(errors, []);
    const steps = ir!.root.children[0];
    assert.equal(steps.kind, 'steps');
    assert.deepEqual(steps.children.map((c) => [c.kind, c.step?.width, c.step?.height]), [['step', 420, 180], ['step', 600, 440]]);
    assert.equal(ir!.states.length, 1);
    assert.equal(ir!.handlers.length, 5);
    assert.ok(JSON.stringify(ir).includes('"flexDirection":"row"'), 'the CSS imported by the screen files is applied');
  });

  it('when comparing with the single-file version of the same app, then the screen sizes and the navigation effects are the same', async () => {
    const one = (await buildProjectIr(single, 'web')).ir!;
    const many = (await buildProjectIr(multi, 'web')).ir!;
    const sizes = (ir: typeof one) => ir.root.children[0].children.map((s) => s.step);
    assert.deepEqual(sizes(many), sizes(one));
    const navigation = (ir: typeof one) => ir.handlers.flatMap((h) => h.effects.map((e) => JSON.stringify(e))).filter((e) => !e.includes('"set"')).sort();
    assert.deepEqual(navigation(many), navigation(one));
  });
});
