import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateAppHeader } from '../../src/gen/app-header.ts';
import { golden, helloIr, serializers } from './helpers.ts';

describe('given the hello IR', () => {
  it('when generating the app header, then it matches golden/ir-hello/forge_app.hpp', (t) => {
    t.assert.fileSnapshot(generateAppHeader(helloIr()), golden('forge_app.hpp'), { serializers });
  });
});

describe('given an IR with a prerelease version, two states and two handlers', () => {
  const ir = helloIr();
  ir.app.version = '0.1.0-rc.1';
  ir.states.push({ id: 's1', initial: { kind: 'literal', value: '' } });
  ir.handlers.push({ id: 'reset', effects: [] });
  const header = generateAppHeader(ir);

  it('when generating, then APP_VERSION is the full version string', () => {
    assert.ok(header.includes('APP_VERSION = "0.1.0-rc.1";'));
  });
  it('when generating, then every state is an enumerator and every handler is declared', () => {
    assert.ok(header.includes('enum class StateId { s0, s1 };'));
    assert.ok(header.includes('void action_greet(Surface& out);'));
    assert.ok(header.includes('void action_reset(Surface& out);'));
  });
});

describe('given an IR without states', () => {
  it('when generating, then StateId is an empty enum', () => {
    const ir = helloIr();
    ir.states = [];
    assert.ok(generateAppHeader(ir).includes('enum class StateId {};'));
  });
});
