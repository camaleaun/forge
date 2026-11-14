import { describe, it } from 'node:test';
import { generateActionsCpp } from '../../src/generate/actions-cpp.ts';

const golden = (name: string) => new URL(`../golden/hello/${name}`, import.meta.url).pathname;

describe('given the traced effects of the hello actions', () => {
  it('when generating actions.cpp, then it matches golden/hello/actions.cpp', (t) => {
    const effects = { greet: [{ op: 'setText' as const, target: 'message', text: 'Hello, world!' }] };
    t.assert.fileSnapshot(generateActionsCpp(effects), golden('actions.cpp'), { serializers: [(value) => value as string] });
  });
});
