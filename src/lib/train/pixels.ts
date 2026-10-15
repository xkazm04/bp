// The change map's pixel maths: two same-size RGBA buffers -> a 32x18 grid of the largest channel change per cell, the
// share of pixels that moved and that visibly differ, the largest change and the box around every moved pixel; and the
// words the compare panel says about it. Pure and dependency free, so the worker (changeMap.worker.ts), the main-thread
// fallback and scripts/check-train-compare.ts run the same code. The thresholds are the contest winner's (pix.js): a
// change of more than 3 of 255 levels "moved" (encoder and antialiasing noise stays under it), more than 24 is visible.

export const GRID_W = 32;
export const GRID_H = 18;
/** A channel change at or below this is noise: not drawn, not counted as moved. */
export const NOISE = 3;
/** A channel change above this is visible to a person. */
export const VISIBLE = 24;

/** One pair's change map. `cells` (row-major, GRID_W x GRID_H) hold the largest channel change in the cell, 0 when
 *  nothing in it moved; `bbox` is [x0, y0, x1, y1] in image pixels around every moved pixel, absent when none did. */
export interface PixGrid {
  w: number;
  h: number;
  cells: number[];
  /** % of pixels that changed by more than VISIBLE levels. */
  pct: number;
  /** % of pixels that changed by more than NOISE levels. */
  moved: number;
  /** The largest channel change anywhere, 0..255. */
  maxd: number;
  bbox?: [number, number, number, number];
}

/** Compare two RGBA buffers of one size (the before and the after, drawn at the same width and height). Sizes that
 *  differ compare over the smaller common area. */
export function diffPixels(a: ArrayLike<number>, b: ArrayLike<number>, w: number, h: number): PixGrid {
  const cells = new Array<number>(GRID_W * GRID_H).fill(0);
  let moved = 0, vis = 0, maxd = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const gy = Math.min(GRID_H - 1, Math.floor((y * GRID_H) / h)) * GRID_W;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]), Math.abs(a[i + 3] - b[i + 3]));
      if (d > maxd) maxd = d;
      if (d <= NOISE) continue;
      moved++;
      if (d > VISIBLE) vis++;
      const c = gy + Math.min(GRID_W - 1, Math.floor((x * GRID_W) / w));
      if (d > cells[c]) cells[c] = d;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  const n = Math.max(1, w * h), g: PixGrid = { w, h, cells, pct: (vis / n) * 100, moved: (moved / n) * 100, maxd };
  if (x1 >= 0) g.bbox = [x0, y0, x1, y1];
  return g;
}

/** The pair in words, as the winner's pixWords: `same` when a person would see no designed difference (nothing moved,
 *  or under 0.2 % of pixels visibly differ). */
export function pixWords(g: PixGrid): { same: boolean; text: string } {
  if (g.moved === 0) return { same: true, text: `Identical: no pixel differs by more than ${Math.max(1, g.maxd)} of 255 levels.` };
  if (g.pct < 0.2) return { same: true, text: `Visually identical: ${g.moved.toFixed(2)}% of pixels shift by at most ${g.maxd} of 255 levels.` };
  const at = g.bbox ? `, inside x ${g.bbox[0]}–${g.bbox[2]}, y ${g.bbox[1]}–${g.bbox[3]}` : '';
  return { same: false, text: `${g.pct.toFixed(2)}% of pixels differ${at}; at most ${g.maxd} of 255 levels.` };
}

/** The bbox in grid units (the SVG overlay's viewBox is GRID_W x GRID_H). */
export function bboxCells(g: PixGrid): { x: number; y: number; w: number; h: number } | undefined {
  if (!g.bbox) return undefined;
  const [x0, y0, x1, y1] = g.bbox, sx = GRID_W / g.w, sy = GRID_H / g.h;
  return { x: x0 * sx, y: y0 * sy, w: (x1 - x0 + 1) * sx, h: (y1 - y0 + 1) * sy };
}
