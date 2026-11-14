import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateProject } from '../../src/gen/index.ts';
import { layoutOf } from '../../src/gen/layout.ts';
import { helloIr, node } from './helpers.ts';

function withProgress() {
  const ir = helloIr();
  ir.root.children.push(node('progress', 'progress_3', { progress: { value: 0.25, max: 1 }, style: { width: 200, height: 8, color: '#00aa00ff', flex: 1 } }));
  return ir;
}

describe('given an IR with a <progress>', () => {
  it('when laid out, then the node keeps kind progress, its data, size and color', () => {
    const bar = layoutOf(withProgress().root).children[2];
    assert.equal(bar.kind, 'progress');
    assert.deepEqual(bar.progress, { value: 0.25, max: 1 });
    assert.equal(bar.width, 200);
    assert.equal(bar.height, 8);
    assert.equal(bar.grow, true);
    assert.equal(bar.paint.color, '#00aa00ff');
  });

  for (const target of ['macos', 'linux']) {
    it(`when generating for ${target}, then it fails clearly until the generator supports it`, () => {
      assert.throws(() => generateProject(withProgress(), target), { message: `progress is not supported by the ${target} generator yet` });
    });
  }
});
