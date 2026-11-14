import { resolve } from 'node:path';
import { formatLanBanner } from '../dev/banner.ts';
import { createDevServer } from '../dev/server.ts';
import { buildProjectIr } from '../project/build.ts';

export type StartOptions = { project: string; port: number; lan: boolean };

// Starts the dev server and keeps the process alive until SIGINT/SIGTERM.
export async function start(options: StartOptions): Promise<void> {
  const projectDir = resolve(options.project);
  const server = await createDevServer({
    projectDir,
    port: options.port,
    lan: options.lan,
    load: () => buildProjectIr(projectDir),
  });
  console.log(`forge start: ${server.url}`);
  if (options.lan) {
    console.log(server.lanUrls.length > 0
      ? formatLanBanner(server.lanUrls)
      : '--lan: the server is exposed on the local network, but no network interface was found: it is only reachable from this machine (no network).');
  }
  console.log('Press Ctrl+C to stop.');
  const stop = async () => {
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
