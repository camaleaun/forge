import { build } from './build.ts';
import { manifest } from './manifest.ts';

const USAGE = `Usage:
  forge build [--project <dir>] [--target macos] --out <dir>
  forge manifest --dir <dir> --tag <tag> --repo <owner/repo>`;

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
  process.exit(await build({ project: option(args, '--project', '.')!, target: option(args, '--target', 'macos')!, out }));
}

if (command === 'manifest') {
  const dir = option(args, '--dir');
  const tag = option(args, '--tag');
  const repo = option(args, '--repo');
  if (!dir || !tag || !repo) usage();
  process.exit(manifest({ dir, tag, repo }));
}

usage();
