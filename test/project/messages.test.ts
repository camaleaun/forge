import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildProjectIr } from '../../src/project/build.ts';
import { unionMessages } from '../../src/project/messages.ts';

const fixture = new URL('../fixtures/hello-app', import.meta.url).pathname;

describe('given an app with phrases inside <only macos> and <only linux>', () => {
  it('when asking for the union, then it holds the phrases of every target once, whichever target was built first', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'forge-union-'));
    try {
      cpSync(fixture, dir, { recursive: true });
      const app = readFileSync(join(dir, 'App.tsx'), 'utf8').replace('import { state }', 'import { state, __ }').replace(
        '<button onClick={greet}>Greet</button>',
        "<button onClick={greet}>Greet</button><only macos><text>{__('Mac')}</text></only><only linux><text>{__('Lin')}</text></only><text>{__('Mac')}</text>",
      );
      writeFileSync(join(dir, 'App.tsx'), app);
      cpSync(fixture + '/package.json', join(dir, 'package.json'));
      for (const target of ['macos', 'linux', 'web']) {
        const { ir } = await buildProjectIr(dir, target);
        assert.ok(ir);
        const texts = (await unionMessages(dir, { target, ir })).map((m) => m.text).sort();
        assert.deepEqual(texts, ['Lin', 'Mac']);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
