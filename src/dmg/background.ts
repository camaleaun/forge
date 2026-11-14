// Dependency-free renderer for the DMG window background (600x400 points).
// Layout: app icon at x=150, /Applications at x=450, both at y=190, arrow in between.

export interface BackgroundOptions { scale?: 1 | 2 }

export interface BackgroundImage {
  width: number;
  height: number;
  rgba: Uint8Array;
  iconCenters: { app: [number, number]; applications: [number, number] };
}

const WINDOW_WIDTH = 600;
const WINDOW_HEIGHT = 400;
const APP_CENTER: [number, number] = [150, 190];
const APPLICATIONS_CENTER: [number, number] = [450, 190];

const TOP: Rgb = [0xf6, 0xf7, 0xf9];
const BOTTOM: Rgb = [0xe9, 0xeb, 0xef];
const ARROW: Rgb = [0x9a, 0xa1, 0xad];

const ARROW_HALF_LENGTH = 30; // points, from the horizontal center
const ARROW_HEAD = 14; // points, chevron wing reach
const ARROW_HALF_WIDTH = 1.25; // points, half the stroke width

type Rgb = [number, number, number];
type Segment = [number, number, number, number];

function distanceToSegment(px: number, py: number, [ax, ay, bx, by]: Segment): number {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function arrowSegments(): Segment[] {
  const cx = (APP_CENTER[0] + APPLICATIONS_CENTER[0]) / 2;
  const cy = APP_CENTER[1];
  const tip = cx + ARROW_HALF_LENGTH;
  return [
    [cx - ARROW_HALF_LENGTH, cy, tip, cy],
    [tip, cy, tip - ARROW_HEAD, cy - ARROW_HEAD],
    [tip, cy, tip - ARROW_HEAD, cy + ARROW_HEAD],
  ];
}

export function renderDmgBackground(options: BackgroundOptions = {}): BackgroundImage {
  const scale = options.scale ?? 2;
  const width = WINDOW_WIDTH * scale;
  const height = WINDOW_HEIGHT * scale;
  const rgba = new Uint8Array(width * height * 4);
  const segments = arrowSegments();

  for (let y = 0; y < height; y++) {
    const t = y / (height - 1);
    const bg = TOP.map((c, i) => Math.round(c + (BOTTOM[i] - c) * t));
    for (let x = 0; x < width; x++) {
      // Signed distance (in pixels) to the nearest stroke; coverage ramps over one pixel.
      const px = (x + 0.5) / scale, py = (y + 0.5) / scale;
      const d = Math.min(...segments.map((s) => distanceToSegment(px, py, s)));
      const coverage = Math.max(0, Math.min(1, 0.5 - (d - ARROW_HALF_WIDTH) * scale));
      const o = (y * width + x) * 4;
      for (let i = 0; i < 3; i++) rgba[o + i] = Math.round(bg[i] + (ARROW[i] - bg[i]) * coverage);
      rgba[o + 3] = 255;
    }
  }

  return { width, height, rgba, iconCenters: { app: [...APP_CENTER], applications: [...APPLICATIONS_CENTER] } };
}
