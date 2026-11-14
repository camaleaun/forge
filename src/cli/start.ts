import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { formatLanBanner } from '../dev/banner.ts';
import { createDevServer } from '../dev/server.ts';
import { qrMatrix } from '../qr/qr.ts';
import { qrToTerminal } from '../qr/render.ts';
import { buildProjectIr } from '../project/build.ts';
import { handleKey } from './keys.ts';
import { openCommand } from './open.ts';

export type StartOptions = { project: string; port: number; local: boolean };

const KEYS_HINT = 'Keys: o open in browser | q show the QR code | h help | Ctrl+C quit';

// Starts the dev server and keeps the process alive until SIGINT/SIGTERM.
// By default the preview is reachable from the local network (token required) so a phone can open it.
export async function start(options: StartOptions): Promise<void> {
  const projectDir = resolve(options.project);
  const server = await createDevServer({
    projectDir,
    port: options.port,
    lan: !options.local,
    load: () => buildProjectIr(projectDir),
  });
  const localUrl = server.token ? `${server.url}?t=${server.token}` : server.url;
  const phoneUrl = server.lanUrls[0] ?? localUrl;

  console.log(`forge start: ${localUrl}`);
  if (!options.local) {
    console.log(server.lanUrls.length > 0
      ? formatLanBanner(server.lanUrls)
      : 'The server is reachable on the local network, but no network interface was found: it is only reachable from this machine (no network).');
  }
  console.log('Press Ctrl+C to stop.');

  const stop = async () => {
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

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
