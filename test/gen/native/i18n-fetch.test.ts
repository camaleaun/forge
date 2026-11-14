import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { join } from 'node:path';
import { buildApp, canRun, skipReason, optionsFor, PT_FILE, PT_PACK, ptName, removeDir, run, runAsync, tempDir, pluralIr, type App } from './i18n-app.ts';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;
let app: App;
let offApp: App;
let server: Server;
let handler: Handler = () => {};
let requests: string[] = [];
const sockets = new Set<Socket>();
let base = '';
let cache = '';

before(async () => {
  if (!canRun) return;
  app = buildApp(pluralIr(), optionsFor());
  offApp = buildApp(pluralIr(), optionsFor({ download: false }));
  server = createServer((req, res) => {
    requests.push(req.url ?? '');
    handler(req, res);
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});
after(() => {
  for (const socket of sockets) socket.destroy();
  server?.close();
  app?.dispose();
  offApp?.dispose();
});
beforeEach(() => {
  cache = join(tempDir(), 'lang');
  requests = [];
  handler = (_req, res) => res.end(PT_PACK);
});
afterEach(() => removeDir(join(cache, '..')));

const env = (extra: Record<string, string> = {}) => ({ FORGE_I18N_CACHE_DIR: cache, FORGE_I18N_BASE_URL: base, ...extra });
const cached = () => (existsSync(cache) ? readdirSync(cache) : []);

describe('given a fake server that serves the pt-BR pack', { skip: !canRun && skipReason }, () => {
  it('when --forge-fetch-lang pt-BR runs, then it prints the confirmation, exits 0 and writes the cache file', async () => {
    const result = await runAsync(app, ['--forge-fetch-lang', 'pt-BR'], env());
    assert.equal(result.stdout, 'Language pack pt-BR installed\n');
    assert.equal(result.status, 0);
    assert.deepEqual(cached(), [ptName()]);
    assert.equal(readFileSync(join(cache, ptName()), 'utf8'), PT_PACK);
    assert.deepEqual(requests, [`/${PT_FILE}`]);
  });
  it('when the pack was fetched, then --greet in pt-BR uses it without the network', async () => {
    await runAsync(app, ['--forge-fetch-lang', 'pt-BR'], env());
    requests = [];
    const result = run(app, ['--greet'], { FORGE_I18N_CACHE_DIR: cache, LANG: 'pt_BR.UTF-8', FORGE_I18N_BASE_URL: 'http://127.0.0.1:9/' });
    assert.equal(result.stdout, 'Olá, mundo!\n');
    assert.deepEqual(requests, []);
  });
  it('when no tag is given, then the pack of the current locale is fetched', async () => {
    const result = await runAsync(app, ['--forge-fetch-lang'], env({ FORGE_LANG: 'pt_BR' }));
    assert.equal(result.stdout, 'Language pack pt-BR installed\n');
    assert.deepEqual(cached(), [ptName()]);
  });
  it('when --lang gives the tag, then it is used as the default of --forge-fetch-lang', async () => {
    const result = await runAsync(app, ['--lang', 'pt_BR', '--forge-fetch-lang'], env());
    assert.equal(result.stdout, 'Language pack pt-BR installed\n');
  });
  it('when the locale is English and no tag is given, then nothing is downloaded and the exit code is 0', async () => {
    const result = await runAsync(app, ['--forge-fetch-lang'], env());
    assert.equal(result.status, 0);
    assert.match(result.stdout, /English is built in/);
    assert.deepEqual(requests, []);
  });
  it('when the pack is already cached and valid, then it is reported as installed without a request', async () => {
    mkdirSync(cache, { recursive: true });
    writeFileSync(join(cache, ptName()), PT_PACK);
    const result = await runAsync(app, ['--forge-fetch-lang', 'pt-BR'], env());
    assert.equal(result.status, 0);
    assert.deepEqual(requests, []);
  });
  it('when an older pack of the same language is in the cache, then it is deleted after the install', async () => {
    mkdirSync(cache, { recursive: true });
    writeFileSync(join(cache, 'pt-BR-aaaaaaaaaaaa.lang'), 'old');
    writeFileSync(join(cache, 'fr-bbbbbbbbbbbb.lang'), 'other language');
    await runAsync(app, ['--forge-fetch-lang', 'pt-BR'], env());
    assert.deepEqual(cached().sort(), ['fr-bbbbbbbbbbbb.lang', ptName()]);
  });
  it('when the tag has no pack (xx), then it fails with a clear message and no request', async () => {
    const result = await runAsync(app, ['--forge-fetch-lang', 'xx'], env());
    assert.equal(result.status, 1);
    assert.match(result.stderr, /no language pack for "xx"/);
    assert.deepEqual(requests, []);
  });
  it('when the server answers 302 to the real file, then the redirect is followed', async () => {
    handler = (req, res) => {
      if (req.url === `/${PT_FILE}`) {
        res.writeHead(302, { Location: '/moved.lang' });
        res.end();
      } else {
        res.end(PT_PACK);
      }
    };
    const result = await runAsync(app, ['--forge-fetch-lang', 'pt-BR'], env());
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(requests, [`/${PT_FILE}`, '/moved.lang']);
    assert.deepEqual(cached(), [ptName()]);
  });
});

describe('given a server that must not be trusted', { skip: !canRun && skipReason }, () => {
  it('when the content has the right size but another sha256, then nothing is written and the exit code is non-zero', async () => {
    handler = (_req, res) => res.end(Buffer.from(PT_PACK).fill('X', 0, 1));
    const result = await runAsync(app, ['--forge-fetch-lang', 'pt-BR'], env());
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /checksum/);
    assert.deepEqual(cached(), []);
  });
  it('when the content has another size, then it is rejected', async () => {
    handler = (_req, res) => res.end(PT_PACK + '# extra\n');
    const result = await runAsync(app, ['--forge-fetch-lang', 'pt-BR'], env());
    assert.equal(result.status, 1);
    assert.match(result.stderr, /unexpected size/);
    assert.deepEqual(cached(), []);
  });
  it('when the server answers 404, then the exit code is 1 and stderr names the status', async () => {
    handler = (_req, res) => {
      res.writeHead(404);
      res.end('not found');
    };
    const result = await runAsync(app, ['--forge-fetch-lang', 'pt-BR'], env());
    assert.equal(result.status, 1);
    assert.match(result.stderr, /HTTP 404/);
    assert.deepEqual(cached(), []);
  });
  it('when the server redirects to plain http on another host, then the redirect is refused', async () => {
    handler = (_req, res) => {
      res.writeHead(302, { Location: 'http://example.com/pack.lang' });
      res.end();
    };
    const result = await runAsync(app, ['--forge-fetch-lang', 'pt-BR'], env());
    assert.equal(result.status, 1);
    assert.match(result.stderr, /HTTP 302/);
    assert.deepEqual(cached(), []);
  });
  it('when the server never answers, then the timeout (FORGE_I18N_TIMEOUT_MS) ends the attempt with a failure', async () => {
    handler = () => {};
    const started = Date.now();
    const result = await runAsync(app, ['--forge-fetch-lang', 'pt-BR'], env({ FORGE_I18N_TIMEOUT_MS: '400' }));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /time/i);
    assert.ok(Date.now() - started < 10000, 'it did not wait for the default 10 s');
    assert.deepEqual(cached(), []);
  });
  it('when the base URL is plain http on a non-loopback host, then the download is refused before any connection', async () => {
    const result = await runAsync(app, ['--forge-fetch-lang', 'pt-BR'], env({ FORGE_I18N_BASE_URL: 'http://example.com/' }));
    assert.equal(result.status, 1);
    assert.match(result.stderr, /refusing to download/);
    assert.deepEqual(cached(), []);
  });
  it('when the app was built with downloads disabled, then --forge-fetch-lang fails without a request', async () => {
    const result = await runAsync(offApp, ['--forge-fetch-lang', 'pt-BR'], env());
    assert.equal(result.status, 1);
    assert.match(result.stderr, /disabled/);
    assert.deepEqual(requests, []);
  });
  it('when --greet runs in pt-BR with an empty cache, then there is no automatic download in CLI mode', async () => {
    const result = await runAsync(app, ['--greet'], env({ FORGE_LANG: 'pt-BR' }));
    assert.equal(result.stdout, 'Hello, world!\n');
    assert.deepEqual(requests, []);
  });
});
