import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodePng } from '../dmg/png.ts';
import { buildIcns } from './icns.ts';
import { rasterizeSvg } from './raster.ts';
import { parseSvg } from './svg.ts';

export interface IconAssets { icns: string; png512: string; favicon32: string }

/** Renders icon.svg into <name>.icns, <name>-512.png and <name>-32.png inside dir. */
export function writeIconAssets(svg: string, dir: string, options: { name?: string } = {}): IconAssets {
  const name = options.name ?? 'AppIcon';
  // Render everything before touching the file system so an invalid SVG leaves nothing behind.
  const doc = parseSvg(svg);
  const icns = buildIcns(svg);
  const png512 = encodePng(512, 512, rasterizeSvg(doc, 512));
  const png32 = encodePng(32, 32, rasterizeSvg(doc, 32));

  mkdirSync(dir, { recursive: true });
  const paths = { icns: join(dir, `${name}.icns`), png512: join(dir, `${name}-512.png`), favicon32: join(dir, `${name}-32.png`) };
  writeFileSync(paths.icns, icns);
  writeFileSync(paths.png512, png512);
  writeFileSync(paths.favicon32, png32);
  return paths;
}
