import { build } from './build.ts';
import { i18n } from './i18n.ts';
import { INFO_FIELDS, info } from './info.ts';
import { start } from './start.ts';
import { manifest } from './manifest.ts';

const USAGE = `Usage:
  forge build [--project <dir>] [--target macos] --out <dir> [--strict-i18n]
  forge i18n extract [--project <dir>]
  forge i18n check [--project <dir>] [--strict]
  forge manifest --dir <dir> --tag <tag> --repo <owner/repo>
  forge info [--project <dir>] --field name|version
  forge start [--project <dir>] [--port 5170] [--local] [--qr]`;

function option(args: string[], name: string, fallback?: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

function usage(): never {
  console.error(USAGE);
  process.exit(2);
}

const [command, ...args] = process.argv.slice(2);

if (command === 'build') {
  const out = option(args, '--out');
  if (!out) usage();
  process.exit(await build({ project: option(args, '--project', '.')!, target: option(args, '--target', 'macos')!, out, strictI18n: args.includes('--strict-i18n') }));
}

if (command === 'i18n') {
  const action = args[0];
  if (action !== 'extract' && action !== 'check') usage();
  process.exit(await i18n({ action, project: option(args, '--project', '.')!, strict: args.includes('--strict') }));
}

if (command === 'manifest') {
  const dir = option(args, '--dir');
  const tag = option(args, '--tag');
  const repo = option(args, '--repo');
  if (!dir || !tag || !repo) usage();
  process.exit(manifest({ dir, tag, repo }));
}

if (command === 'info') {
  const field = option(args, '--field');
  if (!field || !INFO_FIELDS.includes(field)) usage();
  process.exit(info({ project: option(args, '--project', '.')!, field }));
}

if (command === 'start') {
  const port = Number(option(args, '--port', '5170'));
  if (!Number.isInteger(port) || port < 0 || port > 65535) usage();
  await start({ project: option(args, '--project', '.')!, port, local: args.includes('--local'), qr: args.includes('--qr') });
} else {
  usage();
}
