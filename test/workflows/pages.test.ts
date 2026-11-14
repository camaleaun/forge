import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const workflow = '.github/workflows/pages.yml';
const hasActionlint = spawnSync('actionlint', ['--version']).status === 0;
const text = () => readFileSync(workflow, 'utf8');

describe('given the docs site workflow', () => {
  it('when looked up, then pages.yml exists', () => {
    assert.ok(existsSync(workflow), `${workflow} is missing`);
  });

  it('when linted with actionlint, then it reports nothing', { skip: !hasActionlint && 'actionlint not installed' }, () => {
    const result = spawnSync('actionlint', [workflow], { encoding: 'utf8' });
    assert.equal(result.stdout + result.stderr, '');
    assert.equal(result.status, 0);
  });

  it('when read, then it builds the site with Node 24 and caches npm from site/package-lock.json', () => {
    assert.match(text(), /node-version:\s*'?24'?/);
    assert.match(text(), /cache-dependency-path:\s*site\/package-lock\.json/);
  });

  it('when read, then it runs on trunk pushes touching site/ and on demand', () => {
    assert.match(text(), /branches:\s*\[trunk\]/);
    assert.match(text(), /- 'site\/\*\*'/);
    assert.match(text(), /workflow_dispatch:/);
  });

  it('when read, then it deploys site/dist with the pages and id-token permissions', () => {
    assert.match(text(), /pages:\s*write/);
    assert.match(text(), /id-token:\s*write/);
    assert.match(text(), /path:\s*site\/dist/);
    assert.match(text(), /actions\/deploy-pages@v4/);
    assert.match(text(), /name:\s*github-pages/);
  });
});
