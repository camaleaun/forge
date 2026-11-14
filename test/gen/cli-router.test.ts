import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateCliRouter } from '../../src/gen/cli-router.ts';
import { golden, helloIr, serializers } from './helpers.ts';

describe('given the hello IR', () => {
  it('when generating the router, then it matches golden/ir-hello/cli_router.cpp', (t) => {
    t.assert.fileSnapshot(generateCliRouter(helloIr()), golden('cli_router.cpp'), { serializers });
  });
});

describe('given a command with a longer flag and a quoted description', () => {
  const ir = helloIr();
  ir.commands.push({ flag: '--say-goodbye-loudly', description: { kind: 'literal', value: 'Say "bye"' }, handler: 'greet' });
  const source = generateCliRouter(ir);

  it('when generating, then the help columns align to the longest flag', () => {
    assert.ok(source.includes('"  --greet               Print the greeting"'));
    assert.ok(source.includes('"  --say-goodbye-loudly  Say \\"bye\\""'));
    assert.ok(source.includes('"  --help                Show this help"'));
  });
  it('when generating, then each command calls its handler', () => {
    assert.ok(source.includes('if (arg == "--say-goodbye-loudly") {\n    action_greet(out);'));
  });
});

describe('given an IR without commands', () => {
  it('when generating, then only the built-in options exist', () => {
    const ir = helloIr();
    ir.commands = [];
    const source = generateCliRouter(ir);
    assert.ok(source.includes('"  --version  Print the version"'));
    assert.ok(!source.includes('action_'));
  });
});
