import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateActionsCpp } from '../../src/gen/actions-cpp.ts';
import { golden, helloIr, serializers } from './helpers.ts';

describe('given the hello IR', () => {
  it('when generating actions, then it matches golden/ir-hello/actions.cpp', (t) => {
    t.assert.fileSnapshot(generateActionsCpp(helloIr()), golden('actions.cpp'), { serializers });
  });
});

describe('given a handler with quotes and a newline in its text and a handler without effects', () => {
  const ir = helloIr();
  ir.handlers[0].effects = [{ op: 'set', state: 's0', value: { kind: 'literal', value: 'Say "hi"\nbye' } }];
  ir.handlers.push({ id: 'noop', effects: [] });
  const source = generateActionsCpp(ir);

  it('when generating, then the text is an escaped C++ literal', () => {
    assert.ok(source.includes('out.set_state(StateId::s0, "Say \\"hi\\"\\nbye");'));
  });
  it('when a handler has no effects, then its parameter is marked unused', () => {
    assert.ok(source.includes('void action_noop(Surface& out) {\n  (void)out;\n}'));
  });
});

describe('given a handler with two effects', () => {
  it('when generating, then the effects are emitted in order', () => {
    const ir = helloIr();
    ir.states.push({ id: 's1', initial: { kind: 'literal', value: '' } });
    ir.handlers[0].effects.push({ op: 'set', state: 's1', value: { kind: 'literal', value: 'x' } });
    const source = generateActionsCpp(ir);
    assert.ok(source.indexOf('StateId::s0') < source.indexOf('StateId::s1'));
  });
});
