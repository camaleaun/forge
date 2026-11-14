import { build } from './build.ts';

const USAGE = `Usage: forge build [--project <dir>] [--target macos] --out <dir>`;

function option(args: string[], name: string, fallback?: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1];
}

const [command, ...args] = process.argv.slice(2);

if (command === 'build') {
  const out = option(args, '--out');
  if (!out) {
    console.error(USAGE);
    process.exit(2);
  }
  process.exit(await build({ project: option(args, '--project', '.')!, target: option(args, '--target', 'macos')!, out }));
}

console.error(USAGE);
process.exit(2);
