import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDevServer, isIgnoredChange } from '../../src/dev/server.ts';
import type { DevServer } from '../../src/dev/server.ts';
import { helloIr } from './helpers.ts';

type Res = { status: number; headers: http.IncomingHttpHeaders; body: string };

function get(url: string, headers: Record<string, string> = {}): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers, agent: false }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => (body += d));
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body }));
    });
    req.on('error', reject);
  });
}

/** Opens /events and resolves helpers to wait for text in the stream. */
function sse(url: string): Promise<{ waitFor(text: string, ms: number): Promise<boolean>; text(): string; close(): void }> {
  return new Promise((resolve, reject) => {
    let buf = '';
    const waiters: (() => void)[] = [];
    const req = http.get(url + 'events', { agent: false }, (res) => {
      res.setEncoding('utf8');
      res.on('data', (d) => {
        buf += d;
        waiters.forEach((w) => w());
      });
      resolve({
        text: () => buf,
        close: () => req.destroy(),
        waitFor: (text, ms) =>
          new Promise((done) => {
            const check = () => buf.includes(text) && (clearTimeout(timer), done(true));
            const timer = setTimeout(() => done(false), ms);
            waiters.push(check);
            check();
          }),
      });
    });
    req.on('error', (e) => ((e as NodeJS.ErrnoException).code === 'ECONNRESET' ? undefined : reject(e)));
  });
}

describe('given a dev server for the hello project', () => {
  let dir: string;
  let server: DevServer;
  let loads: () => Promise<{ ir?: ReturnType<typeof helloIr>; errors: string[] }>;
  let failing = false;
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'forge-dev-'));
    mkdirSync(join(dir, 'node_modules'));
    loads = async () => {
      if (failing) throw new Error('boom <b>');
      return { ir: helloIr(), errors: [] };
    };
    server = await createDevServer({ projectDir: dir, load: loads, port: 0 });
  });
  after(async () => {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('when starting then it listens on 127.0.0.1 with no token', () => {
    assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    assert.equal(server.token, undefined);
    assert.deepEqual(server.lanUrls, []);
  });
  it('when requesting / then the hello page with the label and button is served as HTML', async () => {
    const res = await get(server.url);
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type']!, /^text\/html/);
    assert.match(res.body, /Press the button/);
    assert.match(res.body, /<button[^>]*>Greet<\/button>/);
  });
  it('when requesting /ir.json then it round-trips to the fixture', async () => {
    const res = await get(server.url + 'ir.json');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type']!, /^application\/json/);
    assert.deepEqual(JSON.parse(res.body), helloIr());
  });
  it('when requesting other paths then 404, including traversal attempts', async () => {
    assert.equal((await get(server.url + 'App.tsx')).status, 404);
    assert.equal((await get(server.url + 'package.json')).status, 404);
    const port = new URL(server.url).port;
    const raw = await new Promise<string>((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path: '/../etc/passwd', agent: false }, (res) => resolve(String(res.statusCode)));
      req.on('error', reject);
      req.end();
    });
    assert.equal(raw, '404');
    assert.equal((await get(server.url + '%2e%2e/%2e%2e/etc/passwd')).status, 404);
  });
  it('when sending no CORS headers then none are present', async () => {
    const res = await get(server.url + 'ir.json', { Origin: 'http://evil.example' });
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  });
  it('when the Host header is foreign then 403 (DNS rebinding)', async () => {
    assert.equal((await get(server.url, { Host: 'evil.example' })).status, 403);
    const port = new URL(server.url).port;
    assert.equal((await get(server.url, { Host: `evil.example:${port}` })).status, 403);
    assert.equal((await get(server.url, { Host: `localhost:${port}` })).status, 200);
  });
  it('when reload() is called then /events receives data: reload', async () => {
    const stream = await sse(server.url);
    assert.equal(await stream.waitFor(':', 2000), true, 'connection comment');
    server.reload();
    assert.equal(await stream.waitFor('data: reload\n\n', 2000), true);
    stream.close();
  });
  it('when a project file changes then /events receives data: reload within 2 s', async () => {
    const stream = await sse(server.url);
    await stream.waitFor(':', 2000);
    writeFileSync(join(dir, 'App.css'), 'window { gap: 12px }');
    assert.equal(await stream.waitFor('data: reload\n\n', 2000), true);
    stream.close();
  });
  // The rule is tested directly: waiting for "no event" through the file system is flaky on macOS because FSEvents
  // can deliver late events from earlier writes.
  it('when a change is inside a dependency or build folder then it is ignored, and any other change is not', () => {
    for (const ignored of ['node_modules/x.js', 'a/node_modules/b/c.js', '.git/HEAD', 'build/out.o', 'dist\\app.js', 'out/x', '.build/y']) {
      assert.equal(isIgnoredChange(ignored), true, ignored);
    }
    for (const kept of ['App.css', 'App.tsx', 'languages/pt-BR.lang', 'src/node_modules_like.ts', 'rebuild/x.ts']) {
      assert.equal(isIgnoredChange(kept), false, kept);
    }
    assert.equal(isIgnoredChange(null), false);
  });
  it('when load() throws then the error page is served and the server keeps running', async () => {
    failing = true;
    const res = await get(server.url);
    assert.equal(res.status, 200);
    assert.match(res.body, /boom &lt;b&gt;/);
    failing = false;
    assert.match((await get(server.url)).body, /Press the button/);
  });
  it('when load() reports errors then the error page lists them escaped', async () => {
    const other = await createDevServer({
      projectDir: dir,
      port: 0,
      load: async () => ({ errors: ['App.tsx:3:11: bad <x>'] }),
    });
    try {
      const res = await get(other.url);
      assert.match(res.body, /App\.tsx:3:11: bad &lt;x&gt;/);
      assert.equal((await get(other.url + 'ir.json')).status, 503);
    } finally {
      await other.close();
    }
  });
});

describe('given a dev server in LAN mode', () => {
  let dir: string;
  let server: DevServer;
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'forge-dev-lan-'));
    server = await createDevServer({ projectDir: dir, load: async () => ({ ir: helloIr(), errors: [] }), port: 0, lan: true });
  });
  after(async () => {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const local = () => `http://127.0.0.1:${new URL(server.url).port}/`;

  it('when starting then a 16-byte base64url token is generated', () => {
    assert.match(server.token!, /^[A-Za-z0-9_-]{22}$/);
  });
  it('when listing LAN urls then each is http://<ipv4>:<port>/?t=<token>', () => {
    for (const url of server.lanUrls) {
      assert.match(url, new RegExp(`^http://\\d+\\.\\d+\\.\\d+\\.\\d+:${new URL(server.url).port}/\\?t=${server.token}$`));
    }
  });
  it('when no token is sent then 403', async () => {
    assert.equal((await get(local())).status, 403);
    assert.equal((await get(local() + 'ir.json')).status, 403);
    assert.equal((await get(local() + 'events')).status, 403);
  });
  it('when the token is missing then the 403 body tells the user to open the URL printed by forge start', async () => {
    const res = await get(local());
    assert.match(res.body, /Forbidden/);
    assert.match(res.body, /URL printed by forge start/);
    assert.match(res.body, /\?t=/);
  });
  it('when the Host header is foreign then the 403 body stays a bare Forbidden', async () => {
    const res = await get(local(), { Host: 'evil.example' });
    assert.equal(res.body, 'Forbidden\n');
  });
  it('when the token is wrong then 403', async () => {
    assert.equal((await get(local() + '?t=nope')).status, 403);
    assert.equal((await get(local(), { Cookie: 'forge_token=nope' })).status, 403);
  });
  it('when the token is right then 302 with the cookie, and the clean URL works with the cookie', async () => {
    const first = await get(`${local()}?t=${server.token}`);
    assert.equal(first.status, 302);
    assert.equal(first.headers.location, '/');
    const cookie = first.headers['set-cookie']![0];
    // Lax, not Strict: opening the URL from another app (a QR scan) is a cross-site navigation, and browsers
    // do not send Strict cookies on it (nor on its redirect), which made the phone see 403.
    assert.equal(cookie, `forge_token=${server.token}; HttpOnly; SameSite=Lax; Path=/`);
    const second = await get(local(), { Cookie: cookie.split(';')[0] });
    assert.equal(second.status, 200);
    assert.match(second.body, /Press the button/);
  });
  it('when the Host header is foreign then 403 even with a valid token', async () => {
    const res = await get(`${local()}?t=${server.token}`, { Host: 'evil.example' });
    assert.equal(res.status, 403);
  });
  it('when the caller gives a token then that token is used', async () => {
    const own = await createDevServer({ projectDir: dir, load: async () => ({ errors: [] }), port: 0, lan: true, token: 'fixedtoken' });
    try {
      assert.equal(own.token, 'fixedtoken');
      assert.equal((await get(`http://127.0.0.1:${new URL(own.url).port}/?t=fixedtoken`)).status, 302);
    } finally {
      await own.close();
    }
  });
});

describe('given the network preview without a token (useToken: false)', () => {
  it('when lan is on and useToken is false, then there is no token, network URLs are plain and requests are served; foreign Host headers are still refused', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'forge-dev-open-'));
    const open = await createDevServer({ projectDir: dir, load: async () => ({ ir: helloIr(), errors: [] }), port: 0, lan: true, useToken: false });
    try {
      assert.equal(open.token, undefined);
      assert.ok(open.lanUrls.every((url) => !url.includes('?t=')));
      const base = `http://127.0.0.1:${new URL(open.url).port}/`;
      assert.equal((await get(base)).status, 200);
      assert.equal((await get(base, { Host: 'evil.example' })).status, 403);
    } finally {
      await open.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('given close()', () => {
  it('when closing with an open SSE connection then it resolves and the port is released', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'forge-dev-close-'));
    const server = await createDevServer({ projectDir: dir, load: async () => ({ errors: [] }), port: 0 });
    const stream = await sse(server.url);
    await stream.waitFor(':', 2000);
    await server.close();
    await assert.rejects(get(server.url));
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('given a dev server whose load() returns language packs', () => {
  const PACK = 'forge-lang 1 pt-BR demo 1.0.0\nplural-forms: nplurals=2; plural=(n > 1);\nHello\tOlá\n';
  let dir: string;
  let server: DevServer;
  let packs: { tag: string; text: string }[];
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'forge-dev-lang-'));
    packs = [{ tag: 'pt-BR', text: PACK }];
    server = await createDevServer({ projectDir: dir, load: async () => ({ ir: helloIr(), errors: [], packs }), port: 0 });
  });
  after(async () => {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const base = () => `http://127.0.0.1:${new URL(server.url).port}`;

  it('when requesting a known tag then the pack text is served as UTF-8 plain text', async () => {
    const res = await get(`${base()}/lang/pt-BR.lang`);
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'text/plain; charset=utf-8');
    assert.equal(res.body, PACK);
  });
  it('when the tag is written pt_br or PT-br then it is normalized to pt-BR', async () => {
    assert.equal((await get(`${base()}/lang/pt_br.lang`)).body, PACK);
    assert.equal((await get(`${base()}/lang/PT-br.lang`)).status, 200);
  });
  it('when the tag is unknown then 404', async () => {
    assert.equal((await get(`${base()}/lang/fr-FR.lang`)).status, 404);
  });
  it('when the tag is malformed or a traversal attempt then 404', async () => {
    for (const path of ['/lang/.lang', '/lang/..%2Fsecret.lang', '/lang/%2e%2e/x.lang', '/lang/pt-BR', '/lang/pt-BR.lang/x', '/lang/p.lang', '/lang/pt-BR%00.lang', '/lang/%zz.lang', '/lang/pt-BR.txt']) {
      assert.equal((await get(base() + path)).status, 404, path);
    }
  });
  it('when the packs change then the next request serves the latest load()', async () => {
    packs = [{ tag: 'pt-BR', text: 'v2\tx\n' }, { tag: 'es', text: 'es pack\n' }];
    assert.equal((await get(`${base()}/lang/pt-BR.lang`)).body, 'v2\tx\n');
    assert.equal((await get(`${base()}/lang/es.lang`)).body, 'es pack\n');
    packs = [{ tag: 'pt-BR', text: PACK }];
  });
  it('when requesting / then the page offers the available languages', async () => {
    const res = await get(`${base()}/`);
    assert.match(res.body, /<select id="forge-lang"[\s\S]*<option value="pt-BR">Português \(Brasil\)<\/option>/);
  });
  it('when the Host header is foreign then 403', async () => {
    assert.equal((await get(`${base()}/lang/pt-BR.lang`, { Host: 'evil.example' })).status, 403);
  });
  it('when load() reports errors then the pack is not served', async () => {
    const failing = await createDevServer({ projectDir: dir, load: async () => ({ errors: ['x'], packs }), port: 0 });
    try {
      assert.equal((await get(`http://127.0.0.1:${new URL(failing.url).port}/lang/pt-BR.lang`)).status, 404);
    } finally {
      await failing.close();
    }
  });
});

describe('given a dev server in LAN mode with a language pack', () => {
  let dir: string;
  let server: DevServer;
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), 'forge-dev-lang-lan-'));
    server = await createDevServer({
      projectDir: dir, port: 0, lan: true, token: 'tok',
      load: async () => ({ ir: helloIr(), errors: [], packs: [{ tag: 'pt-BR', text: 'a\tb\n' }] }),
    });
  });
  after(async () => {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const url = () => `http://127.0.0.1:${new URL(server.url).port}/lang/pt-BR.lang`;

  it('when no token is sent then 403', async () => {
    assert.equal((await get(url())).status, 403);
  });
  it('when the token is in the query then it redirects and sets the cookie, then the pack is served with the cookie', async () => {
    const first = await get(url() + '?t=tok');
    assert.equal(first.status, 302);
    const cookie = String(first.headers['set-cookie']).split(';')[0];
    const second = await get(url(), { Cookie: cookie });
    assert.equal(second.status, 200);
    assert.equal(second.body, 'a\tb\n');
  });
  it('when the cookie is wrong then 403', async () => {
    assert.equal((await get(url(), { Cookie: 'forge_token=nope' })).status, 403);
  });
});
