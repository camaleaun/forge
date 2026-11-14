// Linux-only behaviour of the GLib adapter (i18n_linux.cpp): where it keeps settings and packs (XDG folders).
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { buildApp, canRun, onLinux, optionsFor, PT_FILE, PT_PACK, ptName, pluralIr, removeDir, runAsync, tempDir, type App } from './i18n-app.ts';

const APP_ID = 'dev.forge.hello';
let app: App;
let server: Server;
let requests: string[] = [];
let base = '';
let home = '';

before(async () => {
  if (!canRun || !onLinux) return;
  app = buildApp(pluralIr(), optionsFor());
  server = createServer((req, res) => {
    requests.push(req.url ?? '');
    res.writeHead(200);
    res.end(PT_PACK);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});
after(() => {
  server?.closeAllConnections();
  server?.close();
  app?.dispose();
});
beforeEach(() => {
  requests = [];
  home = tempDir();
});
afterEach(() => removeDir(home));

// No FORGE_I18N_CACHE_DIR: the adapter picks the folders from the XDG variables. LANG is empty so that the stored choice decides.
const env = (extra: Record<string, string> = {}) => ({ XDG_CONFIG_HOME: join(home, 'config'), XDG_CACHE_HOME: join(home, 'cache'), HOME: home, LANG: '', FORGE_I18N_BASE_URL: base, ...extra });
const settings = (text: string) => {
  mkdirSync(join(home, 'config', APP_ID), { recursive: true });
  writeFileSync(join(home, 'config', APP_ID, 'settings.ini'), text);
};

describe('given the Linux adapter', { skip: !(canRun && onLinux) && 'needs Linux, g++ and pkg-config glib-2.0 gio-2.0 libsoup-3.0' }, () => {
  it('when a pack is fetched, then it lands in $XDG_CACHE_HOME/<app id>/lang', async () => {
    const result = await runAsync(app, ['--forge-fetch-locale', 'pt-BR'], env());
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(readdirSync(join(home, 'cache', APP_ID, 'lang')), [ptName()]);
    assert.deepEqual(requests, [`/${PT_FILE}`]);
  });
  it('when settings.ini in $XDG_CONFIG_HOME/<app id> stores pt-BR, then the CLI uses it (no LANG, cached pack)', async () => {
    mkdirSync(join(home, 'cache', APP_ID, 'lang'), { recursive: true });
    writeFileSync(join(home, 'cache', APP_ID, 'lang', ptName()), PT_PACK);
    settings('[forge]\nlanguage=pt-BR\n');
    const result = await runAsync(app, ['--greet'], env());
    assert.equal(result.stdout, 'Olá, mundo!\n');
  });
  it('when settings.ini says download=false, then --forge-fetch-locale is refused without a request', async () => {
    settings('[forge]\ndownload=false\n');
    const result = await runAsync(app, ['--forge-fetch-locale', 'pt-BR'], env());
    assert.equal(result.status, 1);
    assert.match(result.stderr, /disabled/);
    assert.deepEqual(requests, []);
    assert.ok(!existsSync(join(home, 'cache', APP_ID)));
  });
  it('when there is no settings.ini, then the CLI stays in English', async () => {
    const result = await runAsync(app, ['--greet'], env());
    assert.equal(result.stdout, 'Hello, world!\n');
  });
});
