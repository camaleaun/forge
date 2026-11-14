import http from 'node:http';
import type { ServerResponse } from 'node:http';
import { watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Ir } from '../ir/types.ts';
import { normalizeTag } from '../i18n/locale.ts';
import { renderErrorPage, renderPage } from './render.ts';

/** A published language pack: header, plural-forms line and entries, as encodeLang produces. */
export type LangPack = { tag: string; text: string };
export type Loaded = { ir?: Ir; errors: string[]; packs?: LangPack[] };

export type DevServerOptions = {
  projectDir: string;
  load: () => Promise<Loaded>;
  port?: number;
  host?: string;
  lan?: boolean;
  /** Require a secret token on the network (default true when lan). false = open on the network, no token. */
  useToken?: boolean;
  token?: string;
};
export type DevServer = { url: string; lanUrls: string[]; token?: string; reload(): void; close(): Promise<void> };

const LANG_PATH = /^\/lang\/([^/]+)\.lang$/;
const LANG_TAG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const COOKIE = 'forge_token';
const DEBOUNCE_MS = 50;
const HEARTBEAT_MS = 15000;
const IGNORED_DIRS = new Set(['node_modules', '.git', 'build', 'dist', 'out', '.build']);

// Changes inside these folders (dependencies, build output) never trigger a reload.
export function isIgnoredChange(filename: string | null): boolean {
  return filename !== null && filename.split(/[\\/]/).some((part) => IGNORED_DIRS.has(part));
}

const digest = (text: string) => createHash('sha256').update(text).digest();
const sameToken = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

/** Non-internal IPv4 addresses of this machine. */
function lanAddresses(): string[] {
  const found: string[] = [];
  for (const infos of Object.values(networkInterfaces())) {
    for (const info of infos ?? []) if (info.family === 'IPv4' && !info.internal) found.push(info.address);
  }
  return found;
}

function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return undefined;
}

export async function createDevServer(options: DevServerOptions): Promise<DevServer> {
  const lan = options.lan === true;
  const bindHost = options.host ?? (lan ? '0.0.0.0' : '127.0.0.1');
  const token = lan && options.useToken !== false ? (options.token ?? randomBytes(16).toString('base64url')) : undefined;
  const clients = new Set<ServerResponse>();
  let allowedHosts = new Set<string>();

  const reload = () => {
    for (const res of clients) res.write('data: reload\n\n');
  };

  const handle = async (req: http.IncomingMessage, res: ServerResponse) => {
    const deny = (body = 'Forbidden\n') => {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }).end(body);
    };
    // DNS rebinding guard: only the names and addresses this server is really reachable under.
    if (!allowedHosts.has((req.headers.host ?? '').toLowerCase())) return deny();

    const url = new URL(req.url ?? '/', 'http://placeholder');
    if (token !== undefined) {
      const queryToken = url.searchParams.get('t');
      if (queryToken !== null && sameToken(queryToken, token)) {
        url.searchParams.delete('t');
        res.writeHead(302, {
          'set-cookie': `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/`,
          location: url.pathname + url.search,
        });
        return res.end();
      }
      const cookie = readCookie(req.headers.cookie, COOKIE);
      if (cookie === undefined || !sameToken(cookie, token)) {
        // The token changes on every start: a phone with an old cookie must open the new URL.
        return deny('Forbidden\n\nOpen the URL printed by forge start (it ends with ?t=<token>). The token changes every time forge start runs.\n');
      }
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return void res.writeHead(404).end();
    }
    if (url.pathname === '/events') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(': connected\n\n');
      clients.add(res);
      const beat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
      beat.unref();
      res.on('close', () => {
        clearInterval(beat);
        clients.delete(res);
      });
      return;
    }
    const loadSafe = async (): Promise<Loaded> => {
      try {
        return await options.load();
      } catch (error) {
        return { errors: [error instanceof Error ? error.message : String(error)] };
      }
    };
    const lang = LANG_PATH.exec(url.pathname);
    if (lang) {
      // The tag only selects among the packs load() returned: nothing here touches the file system.
      let raw = lang[1];
      try {
        raw = decodeURIComponent(raw);
      } catch {
        raw = '';
      }
      raw = raw.replace(/_/g, '-'); // POSIX spelling (pt_br) is accepted
      const tag = LANG_TAG.test(raw) ? normalizeTag(raw) : undefined;
      const loaded = await loadSafe();
      const pack =
        tag !== undefined && loaded.errors.length === 0
          ? (loaded.packs ?? []).find((p) => normalizeTag(p.tag) === tag)
          : undefined;
      if (!pack) return void res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found\n');
      return void res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }).end(pack.text);
    }
    if (url.pathname === '/' || url.pathname === '/ir.json') {
      const loaded = await loadSafe();
      const ok = loaded.ir !== undefined && loaded.errors.length === 0;
      if (url.pathname === '/ir.json') {
        if (!ok) return void res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' }).end('No valid IR\n');
        return void res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }).end(JSON.stringify(loaded.ir));
      }
      const languages = [...new Set((loaded.packs ?? []).map((p) => normalizeTag(p.tag)).filter((t): t is string => t !== undefined))];
      const html = ok ? renderPage(loaded.ir!, { languages }) : renderErrorPage(loaded.errors);
      return void res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(html);
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found\n');
  };

  const server = http.createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, bindHost, () => resolve());
  });
  const port = (server.address() as { port: number }).port;

  const names = ['localhost', '127.0.0.1', '[::1]', ...lanAddresses()];
  if (!['0.0.0.0', '::'].includes(bindHost)) names.push(bindHost);
  allowedHosts = new Set(names.map((name) => `${name}:${port}`.toLowerCase()));

  let timer: NodeJS.Timeout | undefined;
  const watcher: FSWatcher = watch(options.projectDir, { recursive: true }, (_event, filename) => {
    if (isIgnoredChange(filename === null ? null : String(filename))) return;
    clearTimeout(timer);
    timer = setTimeout(reload, DEBOUNCE_MS);
  });

  const lanUrls = lan ? lanAddresses().map((ip) => `http://${ip}:${port}/${token === undefined ? '' : `?t=${token}`}`) : [];
  return {
    url: `http://${bindHost === '0.0.0.0' ? '127.0.0.1' : bindHost}:${port}/`,
    lanUrls,
    token,
    reload,
    close: () =>
      new Promise<void>((resolve) => {
        clearTimeout(timer);
        watcher.close();
        for (const res of clients) res.end();
        clients.clear();
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
