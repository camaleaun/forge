import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadGlassFolder } from '../../src/icon/folder.ts';
import { svgOf } from './helpers.ts';

const layer = svgOf('<circle cx="50" cy="50" r="30" fill="#fff"/>');

function withIconDir(files: Record<string, string>, run: (iconDir: string, root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'forge-glass-'));
  const iconDir = join(root, 'icon');
  mkdirSync(iconDir);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(iconDir, name), content);
  try { run(iconDir, root); } finally { rmSync(root, { recursive: true, force: true }); }
}

describe('given an icon folder with a background and numbered foregrounds', () => {
  it('when foregrounds are 1 and 2, then they are returned in order with the background', () =>
    withIconDir({ 'background.svg': layer, 'foreground-2.svg': layer + '\n', 'foreground-1.svg': layer }, (dir) => {
      const { layers, errors } = loadGlassFolder(dir);
      assert.deepEqual(errors, []);
      assert.equal(layers?.background, layer);
      assert.deepEqual(layers?.foreground, [layer, layer + '\n']);
    }));
});

describe('given an icon folder with mistakes', () => {
  it('when background.svg is missing, then it says so', () =>
    withIconDir({ 'foreground-1.svg': layer }, (dir) => {
      const { layers, errors } = loadGlassFolder(dir);
      assert.equal(layers, undefined);
      assert.deepEqual(errors, ['icon/background.svg is required (the glass background layer)']);
    }));

  it('when there is no foreground, then it asks for foreground-1.svg', () =>
    withIconDir({ 'background.svg': layer }, (dir) => {
      assert.deepEqual(loadGlassFolder(dir).errors, ['icon/ needs at least one foreground layer named foreground-1.svg, foreground-2.svg, ...']);
    }));

  it('when foreground numbers have a gap, then it names the missing one', () =>
    withIconDir({ 'background.svg': layer, 'foreground-1.svg': layer, 'foreground-3.svg': layer }, (dir) => {
      assert.deepEqual(loadGlassFolder(dir).errors, ['icon/foreground-2.svg is missing (foreground layers must be numbered 1..N without gaps)']);
    }));

  it('when an unknown file is present, then it is reported', () =>
    withIconDir({ 'background.svg': layer, 'foreground-1.svg': layer, 'notes.txt': 'x', 'foreground-0.svg': layer }, (dir) => {
      assert.deepEqual(loadGlassFolder(dir).errors, [
        'icon/foreground-0.svg: unexpected file (use background.svg and foreground-1.svg, foreground-2.svg, ...)',
        'icon/notes.txt: unexpected file (use background.svg and foreground-1.svg, foreground-2.svg, ...)',
      ]);
    }));

  it('when a layer has an SVG syntax problem, then the error carries icon/<file>:line:column', () =>
    withIconDir({ 'background.svg': layer, 'foreground-1.svg': '<svg viewBox="0 0 10 10">\n  <text>hi</text>\n</svg>' }, (dir) => {
      const { layers, errors } = loadGlassFolder(dir);
      assert.equal(layers, undefined);
      assert.match(errors[0], /^icon\/foreground-1\.svg:2:3: unsupported element <text>/);
    }));

  it('when a layer is not square, then the error names icon/<file>', () =>
    withIconDir({ 'background.svg': svgOf('<rect width="200" height="100"/>', '0 0 200 100'), 'foreground-1.svg': layer }, (dir) => {
      assert.match(loadGlassFolder(dir).errors[0], /^icon\/background\.svg: .*square/);
    }));

  it('when a layer is a symlink (even to a file inside the folder), then it is refused', () =>
    withIconDir({ 'background.svg': layer, 'real.svg': layer }, (dir, root) => {
      writeFileSync(join(root, 'outside.svg'), layer);
      symlinkSync(join(root, 'outside.svg'), join(dir, 'foreground-1.svg'));
      assert.deepEqual(loadGlassFolder(dir).errors.filter((e) => e.startsWith('icon/foreground-1')), ['icon/foreground-1.svg: symbolic links are not allowed in icon/']);
    }));
});
