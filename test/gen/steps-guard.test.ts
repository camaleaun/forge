import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateProject } from '../../src/gen/index.ts';
import { generateMacosUi } from '../../src/gen/macos.ts';
import { generateLinuxUi } from '../../src/gen/linux.ts';
import { generateActionsCpp } from '../../src/gen/actions-cpp.ts';
import { layoutOf } from '../../src/gen/layout.ts';
import type { Ir } from '../../src/ir/types.ts';
import { helloIr, node } from './helpers.ts';

function withSteps(): Ir {
  const ir = helloIr();
  const text = node('text', 'text_9', { content: { kind: 'literal', value: 'x' } });
  ir.root.children = [node('steps', 'steps_1', { children: [node('step', 'a', { step: { width: 420 }, children: [text] })] })];
  return ir;
}

describe('given an IR with <steps>', () => {
  it('when generating macOS UI code, then it fails with a clear error', () => {
    assert.throws(() => generateMacosUi(withSteps()), { message: 'steps are not supported by the macos generator yet' });
  });
  it('when generating Linux UI code, then it fails with a clear error', () => {
    assert.throws(() => generateLinuxUi(withSteps(), 'dev.forge.hello'), { message: 'steps are not supported by the linux generator yet' });
  });
  it('when generating a whole project for either target, then the same error comes first', () => {
    assert.throws(() => generateProject(withSteps(), 'macos'), { message: 'steps are not supported by the macos generator yet' });
    assert.throws(() => generateProject(withSteps(), 'linux'), { message: 'steps are not supported by the linux generator yet' });
  });
  it('when laying it out, then steps and step are plain boxes (the layout still compiles)', () => {
    const layout = layoutOf(withSteps().root);
    assert.deepEqual([layout.children[0].kind, layout.children[0].children[0].kind], ['box', 'box']);
  });
});

describe('given a handler that quits (no steps)', () => {
  it('when generating actions, then it fails because native navigation effects are not implemented yet', () => {
    const ir = helloIr();
    ir.handlers.push({ id: 'quit', effects: [{ op: 'quit' }] });
    assert.throws(() => generateActionsCpp(ir), { message: 'the quit and navigation effects are not supported by the native generators yet' });
  });
});
