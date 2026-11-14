import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildManifest } from '../release/manifest.ts';
import type { Asset } from '../release/manifest.ts';

export type ManifestCommand = { dir: string; tag: string; repo: string };

// Returns the process exit code; the manifest goes to stdout, errors to stderr.
export function manifest(command: ManifestCommand): number {
  const assets: Asset[] = readdirSync(command.dir).sort().map((name) => {
    const path = join(command.dir, name);
    return { name, sha256: createHash('sha256').update(readFileSync(path)).digest('hex'), size: statSync(path).size };
  });
  try {
    const result = buildManifest({ version: command.tag.replace(/^v/, ''), repo: command.repo, tag: command.tag }, assets);
    console.log(JSON.stringify(result, null, 2));
    return 0;
  } catch (error) {
    console.error(`error: ${(error as Error).message}`);
    return 1;
  }
}
