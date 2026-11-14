import { describe, it } from 'node:test';
import { generateAppHeader } from '../../src/generate/app-header.ts';
import { hello } from '../helpers/fixtures.ts';

const golden = (name: string) => new URL(`../golden/hello/${name}`, import.meta.url).pathname;

describe('given the hello spec and its actions', () => {
  it('when generating forge_app.hpp, then it matches golden/hello/forge_app.hpp', (t) => {
    t.assert.fileSnapshot(generateAppHeader(hello(), ['greet']), golden('forge_app.hpp'), { serializers: [(value) => value as string] });
  });
});
