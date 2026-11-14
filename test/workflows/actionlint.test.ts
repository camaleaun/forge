import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const workflow = '.github/workflows/ci.yml';
const hasActionlint = spawnSync('actionlint', ['--version']).status === 0;

describe('given the repository CI workflow', () => {
  it('when looked up, then ci.yml exists', () => {
    assert.ok(existsSync(workflow), `${workflow} is missing`);
  });

  it('when linted with actionlint, then it reports nothing', { skip: !hasActionlint && 'actionlint not installed' }, () => {
    const result = spawnSync('actionlint', [workflow], { encoding: 'utf8' });
    assert.equal(result.stdout + result.stderr, '');
    assert.equal(result.status, 0);
  });
});
