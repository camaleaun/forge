// forge::remote: the portable policy against a scripted adapter (any machine with a C++ compiler), and the
// platform adapter (NSURLSession on macOS, libsoup 3 on Linux) against a fake loopback server.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer as createHttp, type IncomingMessage, type Server } from 'node:http';
import { createServer as createHttps } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { RUNTIME_DIR } from '../../../src/gen/index.ts';
import { ROOT } from '../helpers.ts';

const has = (command: string, args: string[]): boolean => spawnSync(command, args).status === 0;
const FIXTURES = join(ROOT, 'test/gen/fixtures');
const darwin = process.platform === 'darwin' && has('clang++', ['--version']);
const linux = process.platform === 'linux' && has('g++', ['--version']) && has('pkg-config', ['--exists', 'glib-2.0', 'gio-2.0', 'libsoup-3.0']);
const anyCompiler = has('c++', ['--version']);
const work = mkdtempSync(join(tmpdir(), 'forge-http-'));
after(() => rmSync(work, { recursive: true, force: true }));

function build(name: string, extra: string[]): string {
  const out = join(work, name);
  const common = [`-I${RUNTIME_DIR}`, '-o', out];
  const sources = [join(FIXTURES, 'http-driver.cpp'), join(RUNTIME_DIR, 'http_common.cpp')];
  const args = darwin && extra.includes('native')
    ? ['clang++', '-std=c++17', '-fobjc-arc', '-framework', 'Foundation', ...common, ...sources, join(RUNTIME_DIR, 'http_macos.mm')]
    : extra.includes('native')
      ? ['g++', '-std=c++17', ...common, ...sources, join(RUNTIME_DIR, 'http_linux.cpp'),
        ...spawnSync('pkg-config', ['--cflags', '--libs', 'glib-2.0', 'gio-2.0', 'libsoup-3.0'], { encoding: 'utf8' }).stdout.trim().split(/\s+/)]
      : ['c++', '-std=c++17', ...common, ...sources, join(FIXTURES, 'http_fake_adapter.cpp')];
  const result = spawnSync(args[0], args.slice(1), { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return out;
}

interface Parsed { code: number; message: string; error: string; headers: string[]; lookup: string; progress: number[][]; body: string; raw: string }
function parse(raw: string): Parsed {
  const at = raw.indexOf('BODY\n');
  const lines = raw.slice(0, at).split('\n');
  const pick = (prefix: string) => lines.filter((l) => l.startsWith(prefix + ' ')).map((l) => l.slice(prefix.length + 1));
  return {
    code: Number(pick('code')[0]), message: pick('message')[0] ?? '', error: pick('error')[0] ?? '', headers: pick('H'),
    lookup: pick('L')[0] ?? '', progress: pick('P').map((l) => l.split(' ').map(Number)), body: raw.slice(at + 5), raw,
  };
}
function run(binary: string, args: string[], env: Record<string, string> = {}): Promise<Parsed> {
  return new Promise((resolve) => {
    const child = spawn(binary, args, { env: { ...process.env, ...env } });
    let out = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.on('close', () => resolve(parse(out)));
  });
}

describe('given the portable policy of forge::remote and a scripted adapter', { skip: anyCompiler ? false : 'needs a C++ compiler' }, () => {
  let binary = '';
  before(() => {
    binary = build('policy', []);
  });
  const map = (...lines: string[]) => ({ FORGE_FAKE_MAP: lines.join('\n') });
  const sent = (p: Parsed) => p.raw.split('\n').filter((l) => l.startsWith('X '));
  // The fake prints its exchanges before the driver's facts, so run() cannot hide them: read the whole output.
  const exchanges = (args: string[], env = {}) => {
    const out = spawnSync(binary, args, { encoding: 'utf8', env: { ...process.env, ...env } }).stdout;
    return { out, parsed: parse(out), sent: out.split('\n').filter((l) => l.startsWith('X ')) };
  };

  it('when a plain https request is answered, then the code, message, headers and body come back', async () => {
    const r = await run(binary, ['GET', 'https://a.example/x', 'lookup=content-LENGTH']);
    assert.deepEqual([r.code, r.message, r.error, r.body, r.lookup], [200, 'OK', '', 'ok', '2']);
  });
  it('when the URL is http to a remote host, then it is refused before anything is sent', () => {
    const r = exchanges(['GET', 'http://example.com/x']);
    assert.equal(r.parsed.error, 'refused_url');
    assert.deepEqual(r.sent, []);
  });
  it('when the URL is http to loopback, then it is allowed', () => {
    for (const host of ['127.0.0.1:80', 'localhost', '[::1]:8080', '127.9.9.9'])
      assert.equal(exchanges(['GET', `http://${host}/`]).parsed.error, '', host);
  });
  it('when the URL is malformed, then the error is invalid_url', () => {
    for (const url of ['nonsense', 'https://', 'ftp://a.example/', 'https://a b/']) assert.equal(exchanges(['GET', url]).parsed.error, 'invalid_url', url);
  });
  it('when the method has a line break, then it is invalid_url and nothing is sent', () => {
    const r = exchanges(['GET\r\nX: y', 'https://a.example/']);
    assert.deepEqual([r.parsed.error, r.sent], ['invalid_url', []]);
  });
  it('when a header name or value has CR or LF, then it is invalid_header and nothing is sent', () => {
    for (const header of ['X-A: b\r\nInjected: 1', 'X-A\nB: c', ': nameless'])
      assert.deepEqual([exchanges(['GET', 'https://a.example/', `header=${header}`]).parsed.error, exchanges(['GET', 'https://a.example/', `header=${header}`]).sent], ['invalid_header', []], header);
  });
  it('when no User-Agent is given, then it is forge/unknown; the argument overrides it', () => {
    assert.match(exchanges(['GET', 'https://a.example/']).out, /XH User-Agent: forge\/unknown\n/);
    assert.match(exchanges(['GET', 'https://a.example/', 'ua=mine/1']).out, /XH User-Agent: mine\/1\n/);
  });
  it('when the caller sets a User-Agent header, then it is not duplicated', () => {
    const out = exchanges(['GET', 'https://a.example/', 'header=user-agent: mine']).out;
    assert.equal(out.match(/XH user-agent/gi)?.length, 1);
  });
  it('when the answer is a redirect chain, then it is followed to the end', () => {
    const r = exchanges(['GET', 'https://a.example/a'], map('https://a.example/a|302|/b', 'https://a.example/b|301|https://c.example/z'));
    assert.deepEqual(r.sent, ['X GET https://a.example/a', 'X GET https://a.example/b', 'X GET https://c.example/z']);
    assert.equal(r.parsed.code, 200);
  });
  it('when redirects exceed the limit, then the error is too_many_redirects', () => {
    const env = map('https://a.example/a|302|/b', 'https://a.example/b|302|/c', 'https://a.example/c|302|/d');
    assert.equal(exchanges(['GET', 'https://a.example/a', 'redirection=2'], env).parsed.error, 'too_many_redirects');
    assert.equal(exchanges(['GET', 'https://a.example/a', 'redirection=3'], env).parsed.error, '');
  });
  it('when a hop is refused by `allowed`, then the 3xx is the answer', () => {
    const r = exchanges(['GET', 'https://a.example/a', 'deny=evil'], map('https://a.example/a|302|https://evil.example/x'));
    assert.deepEqual([r.parsed.code, r.parsed.error, r.sent.length], [302, '', 1]);
  });
  it('when an https answer redirects to http (even loopback), then the downgrade is refused: the 3xx is the answer', () => {
    const r = exchanges(['GET', 'https://a.example/a'], map('https://a.example/a|302|http://127.0.0.1/x'));
    assert.deepEqual([r.parsed.code, r.sent.length], [302, 1]);
  });
  it('when a redirect goes to a non-http scheme or a plain remote http host, then it is refused the same way', () => {
    for (const to of ['http://example.com/x', 'ftp://a.example/x']) {
      const r = exchanges(['GET', 'https://a.example/a'], map(`https://a.example/a|302|${to}`));
      assert.deepEqual([r.parsed.code, r.sent.length], [302, 1], to);
    }
  });
  it('when a POST is redirected with 302/303, then it becomes a GET without a body; 307 keeps method and body', () => {
    const post = (code: number) => exchanges(['POST', 'https://a.example/a', 'body=data', 'header=Content-Type: text/plain'], map(`https://a.example/a|${code}|/b`)).out;
    assert.match(post(303), /X GET https:\/\/a.example\/b\n(?!XH Content-Type)/);
    assert.doesNotMatch(post(303).split('X GET')[1], /XB|Content-Type/);
    assert.match(post(307), /X POST https:\/\/a.example\/b\n[\s\S]*XB data/);
  });
  it('when a redirect leaves the host, then Authorization and Cookie are not forwarded', () => {
    const out = exchanges(['GET', 'https://a.example/a', 'header=Authorization: secret', 'header=Cookie: k=v'], map('https://a.example/a|302|https://b.example/b')).out;
    assert.equal(out.match(/XH Authorization/g)?.length, 1);
    assert.equal(out.match(/XH Cookie/g)?.length, 1);
  });
  it('when the body is over limit_response_size, then the error is too_large', () => {
    const r = exchanges(['GET', 'https://a.example/a', 'limit=3'], map('https://a.example/a|200||0123456789'));
    assert.deepEqual([r.parsed.error, r.parsed.body], ['too_large', '']);
  });
  it('when HEAD is used, then there is no body', () => {
    const r = exchanges(['HEAD', 'https://a.example/a']);
    assert.deepEqual([r.parsed.code, r.parsed.body], [200, '']);
  });
  it('when progress is reported, then it is monotonic and ends at the total', () => {
    const r = exchanges(['GET', 'https://a.example/a', 'progress=1'], map('https://a.example/a|200||0123456789'));
    const steps = r.parsed.progress;
    assert.deepEqual(steps[steps.length - 1], [10, 10]);
    for (let i = 1; i < steps.length; i++) assert.ok(steps[i][0] >= steps[i - 1][0]);
  });
  it('when a response header is looked up, then the name is case-insensitive', () => {
    const r = exchanges(['GET', 'https://a.example/a', 'lookup=LOCATION'], map('https://a.example/a|302|/b', 'https://a.example/b|200'));
    assert.equal(r.parsed.lookup, '');
    const d = exchanges(['GET', 'https://a.example/a', 'lookup=cOnTeNt-LeNgTh'], map('https://a.example/a|200||abc'));
    assert.equal(d.parsed.lookup, '3');
  });
});

describe('given the platform adapter of forge::remote and a fake loopback server', { skip: darwin || linux ? false : 'needs macOS with clang++, or Linux with g++ and pkg-config glib-2.0 gio-2.0 libsoup-3.0' }, () => {
  let binary = '';
  let server: Server;
  let base = '';
  let received = 0;
  let last: { method?: string; headers: IncomingMessage['headers']; body: string } = { headers: {}, body: '' };
  before(async () => {
    binary = build('native', ['native']);
    server = createHttp((req, res) => {
      received++;
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        last = { method: req.method, headers: req.headers, body: Buffer.concat(chunks).toString() };
        const url = req.url ?? '/';
        if (url === '/ok') {
          res.writeHead(200, 'Fine', { 'X-Test': 'Value', 'Content-Length': 5 });
          res.end(req.method === 'HEAD' ? undefined : 'hello');
        } else if (url === '/big') res.end('x'.repeat(20000));
        else if (url === '/echo') {
          res.writeHead(200, { 'X-Echo-Agent': String(req.headers['user-agent']), 'X-Echo-Custom': String(req.headers['x-custom']) });
          res.end(`${req.method}:${last.body}`);
        } else if (url.startsWith('/loop/')) {
          res.writeHead(302, { Location: `/loop/${Number(url.slice(6)) + 1}` });
          res.end();
        } else if (url === '/chain') {
          res.writeHead(302, { Location: '/chain2' });
          res.end();
        } else if (url === '/chain2') {
          res.writeHead(301, { Location: '/ok' });
          res.end();
        } else if (url === '/evil') {
          res.writeHead(302, { Location: '/ok?evil' });
          res.end();
        } else if (url === '/slow') setTimeout(() => res.end('late'), 3000).unref();
        else if (url === '/stream') {
          res.writeHead(200, { 'Content-Length': 30000 });
          let sent = 0;
          const tick = () => {
            res.write('y'.repeat(10000));
            if ((sent += 10000) < 30000) setTimeout(tick, 20);
            else res.end();
          };
          tick();
        } else {
          res.writeHead(404);
          res.end();
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => server.close());
  const go = (args: string[]) => run(binary, args);

  it('when the server answers 200, then code, message, headers and body are returned', async () => {
    const r = await go(['GET', `${base}/ok`, 'lookup=x-TEST']);
    assert.deepEqual([r.code, r.error, r.body, r.lookup], [200, '', 'hello', 'Value']);
    assert.ok(r.message.length > 0);
    assert.ok(r.headers.some((h) => /^x-test: Value$/i.test(h)));
  });
  it('when the body is over limit_response_size, then the error is too_large', async () => {
    assert.equal((await go(['GET', `${base}/big`, 'limit=1000'])).error, 'too_large');
  });
  it('when redirects exceed the limit, then the error is too_many_redirects', async () => {
    assert.equal((await go(['GET', `${base}/loop/0`, 'redirection=3'])).error, 'too_many_redirects');
  });
  it('when the answer is a redirect chain, then it is followed', async () => {
    const r = await go(['GET', `${base}/chain`]);
    assert.deepEqual([r.code, r.body], [200, 'hello']);
  });
  it('when a hop is refused by `allowed`, then the 3xx is returned as is', async () => {
    const r = await go(['GET', `${base}/evil`, 'deny=?evil']);
    assert.deepEqual([r.code, r.error], [302, '']);
  });
  it('when HEAD is used, then there is no body', async () => {
    const r = await go(['HEAD', `${base}/ok`]);
    assert.deepEqual([r.code, r.body, last.method], [200, '', 'HEAD']);
  });
  it('when POST is used, then the headers and body reach the server', async () => {
    const r = await go(['POST', `${base}/echo`, 'body=a=1&b=2', 'header=X-Custom: yes', 'header=Content-Type: application/x-www-form-urlencoded', 'ua=agent/9']);
    assert.equal(r.body, 'POST:a=1&b=2');
    assert.deepEqual([last.headers['x-custom'], last.headers['content-type'], last.headers['user-agent']], ['yes', 'application/x-www-form-urlencoded', 'agent/9']);
  });
  it('when the User-Agent is not set, then it is forge/<version or unknown>', async () => {
    await go(['GET', `${base}/echo`]);
    assert.match(String(last.headers['user-agent']), /^forge\//);
  });
  it('when a header has CR/LF, then the error is invalid_header and the server received nothing', async () => {
    const before = received;
    const r = await go(['GET', `${base}/ok`, 'header=X-A: b\r\nInjected: 1']);
    assert.deepEqual([r.error, received], ['invalid_header', before]);
  });
  it('when the URL is plain http to a non-loopback host, then the error is refused_url', async () => {
    assert.equal((await go(['GET', 'http://example.com/'])).error, 'refused_url');
  });
  it('when the server is slower than the timeout, then the error is timeout', async () => {
    assert.equal((await go(['GET', `${base}/slow`, 'timeout=500'])).error, 'timeout');
  });
  it('when progress is reported, then it is monotonic and ends at the total', async () => {
    const r = await go(['GET', `${base}/stream`, 'progress=1']);
    assert.equal(r.body.length, 30000);
    assert.deepEqual(r.progress[r.progress.length - 1], [30000, 30000]);
    for (let i = 1; i < r.progress.length; i++) assert.ok(r.progress[i][0] >= r.progress[i - 1][0]);
  });
  it('when an https server has a self-signed certificate, then it is refused with tls', { skip: has('openssl', ['version']) ? false : 'needs openssl to make a certificate' }, async () => {
    const key = join(work, 'key.pem'), cert = join(work, 'cert.pem');
    assert.equal(spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-subj', '/CN=localhost', '-days', '1'], { stdio: 'ignore' }).status, 0);
    const { readFileSync } = await import('node:fs');
    const tls = createHttps({ key: readFileSync(key), cert: readFileSync(cert) }, (_req, res) => res.end('secret'));
    await new Promise<void>((resolve) => tls.listen(0, '127.0.0.1', resolve));
    try {
      const r = await go(['GET', `https://localhost:${(tls.address() as AddressInfo).port}/`]);
      assert.deepEqual([r.error, r.body], ['tls', '']);
    } finally {
      tls.close();
    }
  });
});
