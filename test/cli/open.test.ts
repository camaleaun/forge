import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { openCommand } from '../../src/cli/open.ts';

describe('given the URL of the preview', () => {
  const url = 'http://127.0.0.1:5170/?t=abc';

  it('when opening it on macOS, then the command is "open <url>"', () => {
    assert.deepEqual(openCommand('darwin', url), { command: 'open', args: [url] });
  });

  it('when opening it on Linux, then the command is "xdg-open <url>"', () => {
    assert.deepEqual(openCommand('linux', url), { command: 'xdg-open', args: [url] });
  });

  it('when opening it on Windows, then the command goes through cmd /c start with an empty title', () => {
    assert.deepEqual(openCommand('win32', url), { command: 'cmd', args: ['/c', 'start', '', url] });
  });
});
