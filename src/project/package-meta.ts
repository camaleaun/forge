import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PackageMeta } from '../gen/linux-desktop.ts';

// description, license and homepage from package.json (what the Linux packages and metainfo show).
export function readPackageMeta(dir: string): PackageMeta {
  const meta: PackageMeta = {};
  try {
    const raw = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Record<string, unknown>;
    if (typeof raw.description === 'string' && raw.description !== '') meta.description = raw.description;
    if (typeof raw.license === 'string' && raw.license !== '') meta.license = raw.license;
    if (typeof raw.homepage === 'string' && raw.homepage !== '') meta.homepage = raw.homepage;
  } catch {
    // loadProject already read this file; the metadata is optional.
  }
  return meta;
}
