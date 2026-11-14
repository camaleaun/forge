// A button with waitsForDownload is disabled while a language pack downloads and enabled again when the download
// ends or fails: a real window (macOS, or GTK under xvfb), the real platform adapter and a slow loopback server.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { encodeLang } from '../../../src/i18n/lang.ts';
import { generateProject, writeProjectFiles, RUNTIME_DIR } from '../../../src/gen/index.ts';
import { buildProjectIr } from '../../../src/project/build.ts';
import { ROOT } from '../helpers.ts';
import { optionsFor, PT_FILE, sha256, onLinux } from './i18n-app.ts';

const has = (command: string, args: string[]): boolean => spawnSync(command, args).status === 0;
const PACKAGES = ['glib-2.0', 'gio-2.0', 'libsoup-3.0', 'gtk4'];
const pkg = (mode: string): string[] => spawnSync('pkg-config', [mode, ...PACKAGES], { encoding: 'utf8' }).stdout.split(/\s+/).filter(Boolean);
const canRun = onLinux
  ? has('g++', ['--version']) && has('pkg-config', ['--exists', ...PACKAGES]) && has('sh', ['-c', 'command -v xvfb-run'])
  : process.platform === 'darwin' && has('clang++', ['--version']);
const SKIP = 'needs macOS with clang++, or Linux with g++, GTK 4, libsoup 3 and xvfb-run';

const PACK = encodeLang({ tag: 'pt-BR', app: 'hello', version: '0.1.0', entries: [{ text: 'OK', forms: ['OK'] }, { text: 'Filler', forms: ['x'.repeat(300_000)] }] });
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let dir = '';
let binary = '';
let server: Server;
let handler: (req: IncomingMessage, res: ServerResponse) => void = () => {};
const sockets = new Set<Socket>();
let base = '';

before(async () => {
  if (!canRun) return;
  const { ir, errors } = await buildProjectIr(new URL('../../fixtures/steps-app', import.meta.url).pathname, onLinux ? 'linux' : 'macos');
  assert.deepEqual(errors, []);
  const options = optionsFor({ packs: [{ tag: 'pt-BR', file: PT_FILE, sha256: sha256(PACK), size: Buffer.byteLength(PACK) }] });
  dir = mkdtempSync(join(tmpdir(), 'forge-steps-download-'));
  writeProjectFiles(generateProject(ir!, onLinux ? 'linux' : 'macos', { i18n: options, appId: options.appId }), dir);
  const ui = onLinux ? 'ui_linux.cpp' : 'ui_macos.mm';
  const compiler = onLinux ? 'g++' : 'clang++';
  const flags = ['-std=c++20', '-Wall', '-Wextra', '-Werror', '-Wno-unused-function', '-Wno-unused-parameter', '-Wno-deprecated-declarations', '-I', dir, '-I', RUNTIME_DIR, ...(onLinux ? pkg('--cflags') : ['-fobjc-arc'])];
  const sources = [
    join(ROOT, `test/gen/fixtures/ui_steps_driver.${onLinux ? 'cpp' : 'mm'}`), join(dir, ui), join(dir, 'actions.cpp'), join(dir, 'cli_router.cpp'), join(dir, 'messages.cpp'),
    join(RUNTIME_DIR, 'i18n.cpp'), join(RUNTIME_DIR, 'i18n_common.cpp'), join(RUNTIME_DIR, onLinux ? 'i18n_linux.cpp' : 'i18n_macos.mm'),
  ];
  binary = join(dir, 'app');
  const result = spawnSync(compiler, [...flags, ...sources, ...(onLinux ? pkg('--libs') : ['-framework', 'Cocoa']), '-o', binary], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  server = createServer((req, res) => handler(req, res));
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
  if (dir) rmSync(dir, { recursive: true, force: true });
});

// The window opens in pt-BR (so the pack downloads at once); the driver reports the buttons now and after waiting.
function reports(): Promise<string[]> {
  const cache = mkdtempSync(join(tmpdir(), 'forge-steps-cache-'));
  const env = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', LANG: 'en_US.UTF-8', GDK_BACKEND: 'x11', FORGE_I18N_CACHE_DIR: join(cache, 'lang'), FORGE_I18N_BASE_URL: base, FORGE_LANG_PREFERENCE: 'pt-BR' };
  const wait = ['wait', 'wait', 'wait'];
  const command = onLinux ? ['xvfb-run', ['-a', '-s', '-screen 0 1280x800x24', binary, ...wait]] : [binary, wait];
  const child = spawn(command[0] as string, command[1] as string[], { env });
  let stdout = '';
  child.stdout.on('data', (chunk) => (stdout += chunk));
  return new Promise((resolve) =>
    child.on('close', () => {
      rmSync(cache, { recursive: true, force: true });
      resolve(stdout.trim().split('\n').filter((line) => /^\d+x\d+ resizable=/.test(line)));
    }),
  );
}

describe('given the language screen of a steps app while a pack downloads', { skip: !canRun && SKIP }, () => {
  it('when the download is in flight, then OK is disabled; when it ends, then OK is enabled again (Cancel is never disabled)', async () => {
    handler = async (_req, res) => {
      const body = Buffer.from(PACK);
      res.writeHead(200, { 'Content-Length': body.length });
      res.write(body.subarray(0, 1000));
      await pause(700);
      res.write(body.subarray(1000, 2000));
      await pause(700);
      res.end(body.subarray(2000));
    };
    const lines = await reports();
    assert.match(lines[0], /^420x180 resizable=0 .*!OK Cancel$/);
    assert.match(lines.at(-1)!, /^420x180 resizable=0 .* OK Cancel$/);
  });

  it('when the download fails, then OK is enabled again', async () => {
    handler = async (_req, res) => {
      await pause(1200);
      res.writeHead(500);
      res.end('no');
    };
    const lines = await reports();
    assert.match(lines[0], /!OK/);
    assert.match(lines.at(-1)!, /^420x180 resizable=0 .* OK Cancel$/);
  });
});
