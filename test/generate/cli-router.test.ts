import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateCliRouter } from '../../src/generate/cli-router.ts';
import { hello } from '../helpers/fixtures.ts';

const golden = (name: string) => new URL(`../golden/hello/${name}`, import.meta.url).pathname;

describe('given the hello spec', () => {
  it('when generating the CLI router, then it matches golden/hello/cli_router.cpp', (t) => {
    t.assert.fileSnapshot(generateCliRouter(hello()), golden('cli_router.cpp'), { serializers: [(value) => value as string] });
  });
});

describe('given a spec with no commands', () => {
  it('when generating the CLI router, then only --version and --help are routed and no action is called', () => {
    const spec = hello();
    spec.commands = [];
    const source = generateCliRouter(spec);
    assert.ok(source.includes('arg == "--version"') && source.includes('arg == "--help"'));
    assert.ok(!source.includes('action_'));
    assert.ok(!source.includes('--greet'));
  });
});
