import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const root = new URL('../../', import.meta.url).pathname;
const fixture = join(root, 'test/fixtures/hello-app');

// Starts `forge start` and resolves once stdout matches `ready`; the caller stops it with stop().
function startForge(args: string[], ready: RegExp) {
  const child = spawn(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', join(root, 'src/cli/forge.ts'), 'start', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));
  const found = new Promise<RegExpMatchArray>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${ready}; output so far:\n${output}`)), 8000);
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const match = output.match(ready);
      if (match) { clearTimeout(timer); resolve(match); }
    });
    child.on('exit', () => { clearTimeout(timer); reject(new Error(`exited early; output:\n${output}`)); });
  });
  const stop = async () => { child.kill('SIGTERM'); return exited; };
  return { found, stop, output: () => output };
}

// Like a browser: the first visit with ?t= answers 302 + cookie, then the clean URL is fetched with that cookie.
async function visit(url: string): Promise<Response> {
  const first = await fetch(url, { redirect: 'manual' });
  if (first.status !== 302) return first;
  const cookie = (first.headers.get('set-cookie') ?? '').split(';')[0];
  return fetch(new URL(first.headers.get('location') ?? '/', url), { headers: { cookie } });
}

const TOKEN_URL = /http:\/\/127\.0\.0\.1:(\d+)\/\?t=([A-Za-z0-9_-]{22})/;

describe('given the hello app', () => {
  it('when running "forge start" with no flags, then it prints a local URL with a token that serves the page, and refuses requests without the token', async () => {
    const run = startForge(['--project', fixture, '--port', '0'], TOKEN_URL);
    try {
      const match = await run.found;
      const response = await visit(match[0]);
      const html = await response.text();
      assert.equal(response.status, 200);
      assert.ok(html.includes('Hello, forge'));
      assert.ok(html.includes('Press the button'));
      assert.equal((await fetch(`http://127.0.0.1:${match[1]}/`)).status, 403);
    } finally {
      assert.equal(await run.stop(), 0);
    }
  });

  it('when running "forge start" with no flags, then it warns that the server is reachable on the local network and prints a tokenized network URL (or says there is no network)', async () => {
    const run = startForge(['--project', fixture, '--port', '0'], /Press Ctrl\+C to stop\./);
    try {
      await run.found;
      assert.match(run.output(), /local network/i);
      assert.match(run.output(), /http:\/\/\d+\.\d+\.\d+\.\d+:\d+\/\?t=[A-Za-z0-9_-]{22}|no network/i);
    } finally {
      assert.equal(await run.stop(), 0);
    }
  });

  it('when running "forge start --local", then the server is local only: no token, no network warning', async () => {
    const run = startForge(['--project', fixture, '--port', '0', '--local'], /http:\/\/127\.0\.0\.1:(\d+)\//);
    try {
      const match = await run.found;
      assert.ok(!match[0].includes('?t='));
      assert.equal((await fetch(match[0])).status, 200);
      await new Promise((resolve) => setTimeout(resolve, 200));
      assert.ok(!/local network/i.test(run.output()));
    } finally {
      assert.equal(await run.stop(), 0);
    }
  });
});

describe('given a project that does not build', () => {
  it('when running "forge start", then the server still starts and the page shows the error', async () => {
    const run = startForge(['--project', join(root, 'test/fixtures'), '--port', '0'], TOKEN_URL);
    try {
      const match = await run.found;
      const html = await (await visit(match[0])).text();
      assert.ok(html.includes('package.json: cannot read it'));
    } finally {
      assert.equal(await run.stop(), 0);
    }
  });
});
