import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { qrToSvg, qrToTerminal } from '../../src/qr/render.ts';
import { qrMatrix } from '../../src/qr/qr.ts';

describe('given a 2x2 matrix [[dark, light], [light, dark]]', () => {
  const m = [[true, false], [false, true]];
  it('when rendering for the terminal then dark modules are spaces and light modules plus the 2-module quiet zone are blocks (inverted)', () => {
    // 6x6 grid, two grid rows per text line.
    assert.equal(qrToTerminal(m), ['██████', '██▄▀██', '██████'].join('\n'));
  });
  it('when rendering as SVG then the viewBox includes a 4-module quiet zone and each dark module is a unit square', () => {
    const svg = qrToSvg(m);
    assert.match(svg, /^<svg [^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.match(svg, /viewBox="0 0 10 10"/);
    assert.match(svg, /<rect width="10" height="10" fill="#fff"\/>/);
    assert.match(svg, /<path fill="#000" d="M4 4h1v1h-1zM5 5h1v1h-1z"\/>/);
    assert.match(svg, /<\/svg>$/);
  });
});

describe('given an odd-sized matrix', () => {
  it('when rendering for the terminal then the last half row is padded with light modules', () => {
    const lines = qrToTerminal([[true, true, true], [true, true, true], [true, true, true]]).split('\n');
    assert.equal(lines.length, 4); // 7 grid rows -> 8 -> 4 lines
    assert.deepEqual(lines, ['███████', '██   ██', '██▄▄▄██', '███████']);
  });
});

describe('given a real QR matrix', () => {
  const m = qrMatrix('http://192.168.1.20:5170/?t=abc123');
  it('when rendering for the terminal then every line is the grid width and uses only block characters and spaces', () => {
    const lines = qrToTerminal(m).split('\n');
    assert.equal(lines.length, Math.ceil((m.length + 4) / 2));
    for (const line of lines) {
      assert.equal([...line].length, m.length + 4);
      assert.match(line, /^[ ▀▄█]+$/);
    }
  });
  it('when rendering as SVG then there is one square per dark module', () => {
    const dark = m.flat().filter(Boolean).length;
    assert.equal(qrToSvg(m).split('h1v1h-1z').length - 1, dark);
  });
});
