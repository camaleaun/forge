import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateProject } from '../../src/gen/index.ts';
import { generateMacosUi } from '../../src/gen/macos.ts';
import { generateLinuxUi } from '../../src/gen/linux.ts';
import { generateActionsCpp } from '../../src/gen/actions-cpp.ts';
import { generateAppHeader } from '../../src/gen/app-header.ts';
import { layoutOf } from '../../src/gen/layout.ts';
import { buildProjectIr } from '../../src/project/build.ts';
import { helloI18nOptions, helloIr, serializers } from './helpers.ts';

const fixture = (name: string) => new URL(`../fixtures/${name}`, import.meta.url).pathname;
const golden = (name: string) => new URL(`../golden/ir-steps-native/${name}`, import.meta.url).pathname;
const options = helloI18nOptions({ appId: 'dev.forge.steps' });

async function irOf(name: string, target: 'macos' | 'linux') {
  const { ir, errors } = await buildProjectIr(fixture(name), target);
  assert.deepEqual(errors, []);
  return ir!;
}

describe('given the steps-app fixture (a language screen and a hello screen)', () => {
  it('when laying it out, then each step keeps its own window size', async () => {
    const steps = layoutOf((await irOf('steps-app', 'macos')).root).children[0];
    assert.deepEqual(steps.children.map((s) => s.step), [{ width: 420, height: 180 }, { width: 600, height: 440 }]);
  });

  it('when generating the header, then it names the steps and the navigation the actions use', async () => {
    const header = generateAppHeader(await irOf('steps-app', 'macos'), true);
    assert.match(header, /enum class StepId \{ language, hello \};/);
    for (const call of ['go_next', 'go_back', 'go_step(StepId id)', 'quit']) assert.ok(header.includes(`virtual void ${call}`), call);
  });

  it('when generating the header of an app without steps or quit, then there is no navigation (binary size)', () => {
    const header = generateAppHeader(helloIr());
    assert.ok(!header.includes('StepId') && !header.includes('go_next') && !header.includes('quit'));
  });

  it('when generating the actions, then next, back, goTo and quit call the surface in order', async () => {
    const actions = generateActionsCpp(await irOf('steps-app', 'macos'), true);
    assert.match(actions, /void action_confirm\(Surface& out\) \{\n  out\.set_state\(StateId::s0, .*\);\n  out\.go_next\(\);\n\}/);
    assert.ok(actions.includes('  out.go_back();'));
    assert.ok(actions.includes('  out.go_step(StepId::language);'));
    assert.ok(actions.includes('  out.quit();'));
  });

  for (const target of ['macos', 'linux'] as const) {
    it(`when generating the ${target} UI, then every step is registered with its window size and OK waits for downloads`, async () => {
      const ir = await irOf('steps-app', target);
      const source = target === 'macos' ? generateMacosUi(ir, options) : generateLinuxUi(ir, 'dev.forge.steps', options);
      assert.ok(source.includes('add_step('), 'registers the pages');
      assert.ok(source.includes('420, 180') && source.includes('600, 440'));
      assert.ok(source.includes('go_next') && source.includes('go_back'));
      assert.equal(source.match(/bind_download_button\(w_/g)?.length, 1, 'OK is disabled during a download');
    });
  }

  it('when generating a project for either target, then it works and Cancel quits', async () => {
    for (const target of ['macos', 'linux'] as const) {
      const files = generateProject(await irOf('steps-app', target), target, { i18n: options });
      assert.ok((files.get('actions.cpp') as string).includes('out.quit();'));
    }
  });

  it('when a window has no steps, then it stays resizable as before', () => {
    assert.ok(generateMacosUi(helloIr()).includes('NSWindowStyleMaskResizable'));
    assert.ok(!generateLinuxUi(helloIr(), 'dev.forge.hello').includes('set_resizable'));
  });
});

describe('given a steps app', () => {
  for (const name of ['steps-app', 'steps-multifile']) {
    for (const target of ['macos', 'linux'] as const) {
      it(`when generating ${name} for ${target}, then the UI matches its golden`, async (t) => {
        const ir = await irOf(name, target);
        const source = target === 'macos' ? generateMacosUi(ir, options) : generateLinuxUi(ir, 'dev.forge.steps', options);
        t.assert.fileSnapshot(source, golden(`${name}-${target === 'macos' ? 'ui_macos.mm' : 'ui_linux.cpp'}`), { serializers });
      });
    }
  }
  it('when generating the header and the actions, then they match their goldens', async (t) => {
    const ir = await irOf('steps-app', 'macos');
    t.assert.fileSnapshot(generateAppHeader(ir, true), golden('forge_app.hpp'), { serializers });
    t.assert.fileSnapshot(generateActionsCpp(ir, true), golden('actions.cpp'), { serializers });
  });
});
