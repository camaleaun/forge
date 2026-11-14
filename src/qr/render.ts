// Renderers for a QR matrix (true = dark module, no quiet zone).

const TERMINAL_QUIET_ZONE = 2;
const SVG_QUIET_ZONE = 4; // the quiet zone required by the standard

/**
 * Text rendering with Unicode half blocks, two grid rows per line.
 *
 * Inverted on purpose: LIGHT modules (and the quiet zone) are drawn as filled blocks in the
 * terminal's foreground colour, DARK modules are left empty so the terminal background shows
 * through. On a dark terminal this yields dark modules on a light background, which is what
 * scanners expect (on a light terminal the colours invert, which most scanners also accept).
 */
export function qrToTerminal(matrix: boolean[][]): string {
  const n = matrix.length;
  const q = TERMINAL_QUIET_ZONE;
  const dark = (r: number, c: number) => r >= q && c >= q && r < n + q && c < n + q && matrix[r - q][c - q];
  const lines: string[] = [];
  for (let r = 0; r < n + 2 * q; r += 2) {
    let line = '';
    for (let c = 0; c < n + 2 * q; c++) {
      const top = dark(r, c);
      const bottom = dark(r + 1, c); // beyond the grid (odd size) counts as light
      line += top ? (bottom ? ' ' : '▄') : bottom ? '▀' : '█';
    }
    lines.push(line);
  }
  return lines.join('\n');
}

/** Standalone SVG: white background, one black unit square per dark module, 4-module quiet zone. */
export function qrToSvg(matrix: boolean[][]): string {
  const q = SVG_QUIET_ZONE;
  const size = matrix.length + 2 * q;
  let d = '';
  matrix.forEach((row, r) => row.forEach((on, c) => {
    if (on) d += `M${c + q} ${r + q}h1v1h-1z`;
  }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">` +
    `<rect width="${size}" height="${size}" fill="#fff"/><path fill="#000" d="${d}"/></svg>`;
}
