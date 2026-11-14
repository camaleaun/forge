// Reads the optional icon/ folder of a project (background.svg + foreground-N.svg) into glass layers.
// Every problem is reported as a message that names icon/<file> (SVG problems carry :line:column).
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { GlassLayers } from './glass.ts';
import { parseSvg } from './svg.ts';

export const GLASS_FOLDER = 'icon';
const FOREGROUND = /^foreground-([1-9][0-9]*)\.svg$/;
const NAMING = 'use background.svg and foreground-1.svg, foreground-2.svg, ...';

export function loadGlassFolder(dir: string): { layers?: GlassLayers; errors: string[] } {
  const errors: string[] = [];
  const read = new Map<string, string>();
  const foregroundNumbers: number[] = [];
  for (const name of readdirSync(dir).sort()) {
    const label = `${GLASS_FOLDER}/${name}`;
    const match = FOREGROUND.exec(name);
    if (name !== 'background.svg' && !match) {
      errors.push(`${label}: unexpected file (${NAMING})`);
      continue;
    }
    if (match) foregroundNumbers.push(Number(match[1]));
    if (lstatSync(join(dir, name)).isSymbolicLink()) {
      errors.push(`${label}: symbolic links are not allowed in ${GLASS_FOLDER}/`);
      continue;
    }
    const source = readFileSync(join(dir, name), 'utf8');
    try {
      const { viewBox } = parseSvg(source, { file: label });
      if (viewBox.width !== viewBox.height) errors.push(`${label}: a glass icon layer must be square, found ${viewBox.width}x${viewBox.height}`);
    } catch (error) {
      errors.push((error as Error).message);
    }
    read.set(name, source);
  }
  if (!read.has('background.svg') && !errors.some((e) => e.startsWith(`${GLASS_FOLDER}/background.svg`))) {
    errors.push(`${GLASS_FOLDER}/background.svg is required (the glass background layer)`);
  }
  foregroundNumbers.sort((a, b) => a - b);
  if (foregroundNumbers.length === 0) {
    errors.push(`${GLASS_FOLDER}/ needs at least one foreground layer named foreground-1.svg, foreground-2.svg, ...`);
  } else {
    for (let n = 1; n < foregroundNumbers[foregroundNumbers.length - 1]; n++) {
      if (!foregroundNumbers.includes(n)) errors.push(`${GLASS_FOLDER}/foreground-${n}.svg is missing (foreground layers must be numbered 1..N without gaps)`);
    }
  }
  if (errors.length > 0) return { errors };
  return { layers: { background: read.get('background.svg'), foreground: foregroundNumbers.map((n) => read.get(`foreground-${n}.svg`) as string) }, errors };
}
