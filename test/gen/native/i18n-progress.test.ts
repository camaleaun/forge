// The real platform adapter reports the download progress of a language pack: a slow loopback server sends
// the pack in three parts and the app (a stub UI with the real loader and main loop) prints what a bar shows.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { join } from 'node:path';
import { encodeLang } from '../../../src/i18n/lang.ts';
import { buildApp, canRun, skipReason, optionsFor, PT_FILE, removeDir, sha256, runAsync, tempDir, pluralIr, type App } from './i18n-app.ts';

let app: App;
let server: Server;
let handler: (req: IncomingMessage, res: ServerResponse) => void = () => {};
const sockets = new Set<Socket>();
let base = '';

// A pack of about 300 KB: the system's HTTP stack hands small bodies over in one piece, so a bar needs a real size.
const PACK = encodeLang({
  tag: 'pt-BR',
  app: 'hello',
  version: '0.1.0',
  entries: [{ text: 'Greet', forms: ['Cumprimentar'] }, { text: 'Filler', forms: ['x'.repeat(300_000)] }],
});

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Sends the pack in three parts, 400 ms apart, with or without a Content-Length.
function slow(withLength: boolean) {
  return async (_req: IncomingMessage, res: ServerResponse) => {
    const body = Buffer.from(PACK);
    const cut = [Math.floor(body.length * 0.4), Math.floor(body.length * 0.8)];
    res.writeHead(200, withLength ? { 'Content-Length': body.length } : {});
    res.write(body.subarray(0, cut[0]));
    await pause(400);
    res.write(body.subarray(cut[0], cut[1]));
    await pause(400);
    res.end(body.subarray(cut[1]));
  };
}

before(async () => {
  if (!canRun) return;
  app = buildApp(pluralIr(), optionsFor({ packs: [{ tag: 'pt-BR', file: PT_FILE, sha256: sha256(PACK), size: Buffer.byteLength(PACK) }] }), 'ui_progress_stub.cpp');
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
  app?.dispose();
});

async function download(): Promise<number[]> {
  const cache = join(tempDir(), 'lang');
  try {
    const result = await runAsync(app, [], { FORGE_I18N_CACHE_DIR: cache, FORGE_I18N_BASE_URL: base, FORGE_LOCALE_PREFERENCE: 'pt-BR' });
    const lines = result.stdout.trim().split('\n');
    assert.equal(lines.at(-1), 'end pt-BR', result.stdout + result.stderr);
    return lines.slice(0, -1).map((line) => Number(line.replace('progress ', '')));
  } finally {
    removeDir(join(cache, '..'));
  }
}

describe('given a server that sends the language pack slowly', { skip: !canRun && skipReason }, () => {
  for (const [name, withLength] of [['with a Content-Length', true], ['without a Content-Length (the size pinned in the binary is the total)', false]] as const) {
    it(`when the pack arrives in three parts ${name}, then the progress starts at 0, passes between 0 and 100 and the language is applied`, async () => {
      handler = slow(withLength);
      const shown = await download();
      assert.equal(shown[0], 0);
      assert.ok(shown.some((percent) => percent > 0 && percent < 100), `progress shown: ${shown}`);
      assert.deepEqual(shown, [...shown].sort((a, b) => a - b), 'progress never goes back');
    });
  }
});
