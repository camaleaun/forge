import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodePng } from './png.ts';
import { renderDmgBackground } from './background.ts';

export function writeDmgBackground(dir: string): { png1x: string; png2x: string } {
  const png1x = join(dir, 'background.png');
  const png2x = join(dir, 'background@2x.png');
  for (const [file, scale] of [[png1x, 1], [png2x, 2]] as const) {
    const img = renderDmgBackground({ scale });
    writeFileSync(file, encodePng(img.width, img.height, img.rgba));
  }
  return { png1x, png2x };
}
