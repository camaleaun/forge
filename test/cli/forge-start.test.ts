import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
  it('when running "forge start" with no flags, then the preview is shared on the local network WITHOUT a token: plain URLs, a warning, and it serves the page', async () => {
    const run = startForge(['--project', fixture, '--port', '0'], /http:\/\/127\.0\.0\.1:(\d+)\//);
    try {
      const match = await run.found;
      assert.ok(!match[0].includes('?t='));
      const response = await fetch(match[0]);
      assert.equal(response.status, 200);
      assert.ok((await response.text()).includes('Press the button'));
      await new Promise((resolve) => setTimeout(resolve, 200));
      assert.match(run.output(), /local network/i);
      assert.match(run.output(), /http:\/\/\d+\.\d+\.\d+\.\d+:\d+\/(?!\?t=)|no network/i);
      assert.ok(!run.output().includes('?t='));
    } finally {
      assert.equal(await run.stop(), 0);
    }
  });

  it('when running "forge start --token", then it prints a local URL with a token that serves the page, and refuses requests without the token', async () => {
    const run = startForge(['--project', fixture, '--port', '0', '--token'], TOKEN_URL);
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

  it('when running "forge start --token", then it warns about the local network and prints a tokenized network URL (or says there is no network)', async () => {
    const run = startForge(['--project', fixture, '--port', '0', '--token'], /Press Ctrl\+C to stop\./);
    try {
      await run.found;
      assert.match(run.output(), /local network/i);
      assert.match(run.output(), /http:\/\/\d+\.\d+\.\d+\.\d+:\d+\/\?t=[A-Za-z0-9_-]{22}|no network/i);
    } finally {
      assert.equal(await run.stop(), 0);
    }
  });

  it('when running "forge start" with no flags, then the QR code is not printed on its own (it is shown with the q key)', async () => {
    const run = startForge(['--project', fixture, '--port', '0'], /Press Ctrl\+C to stop\./);
    try {
      await run.found;
      assert.ok(!run.output().includes('█'), 'the QR code must not appear until q is pressed');
    } finally {
      assert.equal(await run.stop(), 0);
    }
  });

  it('when running "forge start --qr" and a network exists, then the QR code is printed at startup', async () => {
    const run = startForge(['--project', fixture, '--port', '0', '--qr'], /Press Ctrl\+C to stop\./);
    try {
      await run.found;
      const hasNetwork = /http:\/\/\d+\.\d+\.\d+\.\d+:\d+\//.test(run.output());
      assert.equal(run.output().includes('█'), hasNetwork);
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
    const run = startForge(['--project', join(root, 'test/fixtures'), '--port', '0'], /http:\/\/127\.0\.0\.1:(\d+)\//);
    try {
      const match = await run.found;
      const html = await (await visit(match[0])).text();
      assert.ok(html.includes('package.json: cannot read it'));
    } finally {
      assert.equal(await run.stop(), 0);
    }
  });
});

describe('given a folder that is not an app', () => {
  it('when running "forge start" there, then the terminal says so and suggests --project (not only the browser page)', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'forge-start-empty-'));
    const run = startForge(['--project', empty, '--port', '0', '--local'], /Press Ctrl\+C to stop\./);
    try {
      await run.found;
      assert.match(run.output(), /no App\.tsx in /);
      assert.match(run.output(), /forge start --project <app folder>/);
    } finally {
      assert.equal(await run.stop(), 0);
      rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('given a signal that arrives right after the first output', () => {
  it('when forge start is stopped immediately, then it always exits cleanly with code 0 (the handlers are installed before anything is printed)', async () => {
    for (let attempt = 0; attempt < 12; attempt++) {
      const child = spawn(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', join(root, 'src/cli/forge.ts'), 'start', '--project', fixture, '--port', '0', '--local'], { stdio: ['ignore', 'pipe', 'pipe'] });
      const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
      child.stdout.once('data', () => child.kill('SIGTERM'));
      assert.deepEqual(await exited, { code: 0, signal: null }, `attempt ${attempt}`);
    }
  });
});

describe('given a project with a languages folder', () => {
  it('when running "forge start --local", then the preview serves the language pack and shows the language dropdown', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'forge-start-i18n-'));
    cpSync(fixture, dir, { recursive: true });
    mkdirSync(join(dir, 'languages'));
    writeFileSync(join(dir, 'languages/pt-BR.lang'), 'Greet\tCumprimentar\nHello, forge\tOlá, forge\n');
    writeFileSync(join(dir, 'App.tsx'), (await import('node:fs')).readFileSync(join(dir, 'App.tsx'), 'utf8').replace('<button onClick={greet}>Greet</button>', '<button onClick={greet}>Greet</button>\n      <select language />'));
    const run = startForge(['--project', dir, '--port', '0', '--local'], /http:\/\/127\.0\.0\.1:(\d+)\//);
    try {
      const match = await run.found;
      const pack = await fetch(`http://127.0.0.1:${match[1]}/lang/pt-BR.lang`);
      assert.equal(pack.status, 200);
      const text = await pack.text();
      assert.match(text, /^forge-lang 1 pt-BR hello 0\.1\.0/);
      assert.match(text, /Greet\tCumprimentar/);
      const html = await (await fetch(match[0])).text();
      assert.match(html, /<select[^>]*id="forge-lang"/);
      assert.match(html, /Português \(Brasil\)/);
      assert.equal((await fetch(`http://127.0.0.1:${match[1]}/lang/fr.lang`)).status, 404);
    } finally {
      assert.equal(await run.stop(), 0);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
