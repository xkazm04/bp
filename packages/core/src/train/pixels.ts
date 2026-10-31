// The change map's pixel maths: two same-size RGBA buffers -> a 32x18 grid of the largest channel change per cell, the
// share of pixels that moved and that visibly differ, the largest change and the box around every moved pixel; and the
// words the compare panel says about it, and the crop its changed-area mode zooms to (focusCrop). Pure and dependency free, so the worker (changeMap.worker.ts), the main-thread
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
  /** The two images' natural sizes, [w, h] each, when the caller knew them: a pair of different sizes was scaled, not compared. */
  sizes?: { before: [number, number]; after: [number, number] };
}

/** The grid with the pair's natural sizes, so its words can say when the after was scaled into the before's box. */
export function withSizes(g: PixGrid, before: [number, number], after: [number, number]): PixGrid {
  return { ...g, sizes: { before, after } };
}

/**
 * Compare two RGBA buffers of one size (the before and the after, drawn at the same width and height). `w` and `h`
 * are the stride BOTH buffers are read with, so they must be the size both were drawn at; a sub-rectangle of a wider
 * buffer cannot be read here at all. A pair whose images differ in size is therefore not compared over their common
 * area: both callers take the BEFORE's dimensions (capped at MAX_W) and draw the after into that same box —
 * ChangeMap's worker (changeMap.worker.ts, `drawImage(b, 0, 0, w, h)`) and the main-thread fallback
 * (useChangeMap.ts onMain) — so the after is SCALED to the before's size and a resize reads as a change nearly
 * everywhere. That is the honest reading of a resize, but it is not a common-area comparison.
 */
export function diffPixels(a: ArrayLike<number>, b: ArrayLike<number>, w: number, h: number): PixGrid {
  const cells = new Array<number>(GRID_W * GRID_H).fill(0);
  let moved = 0, vis = 0, maxd = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const gy = Math.min(GRID_H - 1, Math.floor((y * GRID_H) / h)) * GRID_W;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const d = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]), Math.abs(a[i + 3] - b[i + 3]));
      if (d > maxd) maxd = d;
      if (!(d > NOISE)) continue; // also rejects NaN, which an out-of-range read of a short buffer produces
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
  const s = g.sizes;
  if (s && (s.before[0] !== s.after[0] || s.before[1] !== s.after[1])) {
    // a resize is not a designed change: the after was drawn into the before's box, so nearly every pixel reads as moved
    return { same: false, text: `Sizes differ (${s.before[0]}x${s.before[1]} -> ${s.after[0]}x${s.after[1]}): the after was scaled, so most pixels read as changed; ${g.pct.toFixed(2)}% differ.` };
  }
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

/** A crop of the capture, in image fractions (0..1), and how much it enlarges the capture to fill the frame. */
export interface FocusCrop { x: number; y: number; w: number; h: number; zoom: number }
/** The changed-area mode's most a crop enlarges the capture: one image pixel is at most this many frame pixels wide. */
export const MAX_ZOOM = 8;

/**
 * The changed-area crop of a pair: the moved pixels' box, padded by half its larger side (at least 8 px), widened to
 * the frame's `aspect` in image pixels (16:9, ShotFigure.css .tr-scr) and to at least 1 / MAX_ZOOM of the capture,
 * centred on the box and slid inside the image at the edges. null when nothing moved. The one exception to the aspect:
 * a box no `aspect` crop inside the image can hold (a change across the whole capture, or most of a 16:10 one's height)
 * is the full capture { 0, 0, 1, 1 } at zoom 1, letterboxed in the frame as every other mode draws it.
 */
export function focusCrop(g: Pick<PixGrid, 'w' | 'h' | 'bbox'>, aspect = 16 / 9): FocusCrop | null {
  if (!g.bbox || !(g.w > 0 && g.h > 0)) return null;
  const [x0, y0, x1, y1] = g.bbox, bw = x1 - x0 + 1, bh = y1 - y0 + 1, pad = Math.max(8, Math.max(bw, bh) / 2);
  const cw = Math.max(bw + 2 * pad, (bh + 2 * pad) * aspect, g.w / MAX_ZOOM), ch = cw / aspect;
  if (cw > g.w || ch > g.h) {
    // no padded aspect crop fits: the unpadded box at the aspect, else the whole capture
    const tw = Math.max(bw, bh * aspect, g.w / MAX_ZOOM), th = tw / aspect;
    if (tw > g.w || th > g.h) return { x: 0, y: 0, w: 1, h: 1, zoom: 1 };
    return place(g, x0 + bw / 2, y0 + bh / 2, tw, th);
  }
  return place(g, x0 + bw / 2, y0 + bh / 2, cw, ch);
}

const place = (g: Pick<PixGrid, 'w' | 'h'>, cx: number, cy: number, cw: number, ch: number): FocusCrop => {
  const x = Math.min(Math.max(0, cx - cw / 2), g.w - cw), y = Math.min(Math.max(0, cy - ch / 2), g.h - ch);
  return { x: x / g.w, y: y / g.h, w: cw / g.w, h: ch / g.h, zoom: g.w / cw };
};
