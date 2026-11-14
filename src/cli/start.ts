import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { formatLanBanner } from '../dev/banner.ts';
import { createDevServer } from '../dev/server.ts';
import { qrMatrix } from '../qr/qr.ts';
import { qrToTerminal } from '../qr/render.ts';
import { loadProjectI18n } from '../i18n/project.ts';
import { buildProjectIr } from '../project/build.ts';
import { unionMessages } from '../project/messages.ts';
import { handleKey } from './keys.ts';
import { openCommand } from './open.ts';

// By default the preview is shared on the local network with no token (open it from a phone); token = require a secret token; local = this machine only.
export type StartOptions = { project: string; port: number; local: boolean; token: boolean; qr: boolean };

const KEYS_HINT = 'Keys: o open in browser | q show the QR code | h help | Ctrl+C quit';

// Starts the dev server and keeps the process alive until SIGINT/SIGTERM.
// By default the preview is reachable from the local network without a token, so a phone can open it.
// --token requires a secret token on the network; --local keeps the server on this machine only.
export async function start(options: StartOptions): Promise<void> {
  const projectDir = resolve(options.project);
  // Signal handlers first: once anything is printed, Ctrl+C / SIGTERM must always exit cleanly with code 0.
  let closeServer: () => Promise<void> = async () => {};
  const stop = async () => {
    await closeServer();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  const server = await createDevServer({
    projectDir,
    port: options.port,
    lan: !options.local,
    useToken: options.token,
    load: async () => {
      const built = await buildProjectIr(projectDir, 'web');
      if (!built.ir || !built.pkg) return { errors: built.errors };
      // Language packs come from languages/*.lang, the same way `forge build` makes them.
      const i18n = loadProjectI18n(projectDir, built.ir, built.pkg, await unionMessages(projectDir, { target: 'web', ir: built.ir }));
      if (i18n.errors.length > 0) return { errors: i18n.errors };
      return { ir: built.ir, errors: [], packs: i18n.packs.map((pack) => ({ tag: pack.tag, text: pack.text })) };
    },
  });
  closeServer = () => server.close();
  const localUrl = server.token ? `${server.url}?t=${server.token}` : server.url;
  const phoneUrl = server.lanUrls[0] ?? localUrl;

  console.log(`forge start: ${localUrl}`);
  if (!existsSync(join(projectDir, 'App.tsx'))) {
    console.log(`warning: no App.tsx in ${projectDir}: this is not an app folder, so the page shows an error.\nRun it inside an app folder, or: forge start --project <app folder>   (for example forge start --project ../forge-hello-world)`);
  }
  if (!options.local) {
    console.log(server.lanUrls.length > 0
      ? formatLanBanner(server.lanUrls, { qr: options.qr, token: options.token })
      : 'The server is reachable on the local network, but no network interface was found: it is only reachable from this machine (no network).');
  }
  console.log('Press Ctrl+C to stop.');

  if (process.stdin.isTTY) {
    console.log(KEYS_HINT);
    process.stdin.setRawMode(true);
    process.stdin.setEncoding('utf8');
    process.stdin.resume();
    process.stdin.on('data', (key: string) => {
      handleKey(key, {
        open: () => {
          const { command, args } = openCommand(process.platform, localUrl);
          spawn(command, args, { stdio: 'ignore', detached: true }).unref();
          console.log(`Opening ${localUrl}`);
        },
        showQr: () => {
          if (options.local) {
            console.log('The QR code is for opening the preview on your phone: restart without --local so it is shared on your network.');
            return;
          }
          try {
            console.log(`${qrToTerminal(qrMatrix(phoneUrl))}\n${phoneUrl}`);
          } catch {
            console.log(phoneUrl);
          }
        },
        showHelp: () => console.log(KEYS_HINT),
        stop: () => { void stop(); },
      });
    });
  }
}
