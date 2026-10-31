import type { Box } from '@bp/core/model';

/** A camera snapshot plus the screen rectangle to draw into (for culling). */
export interface View {
  x: number; y: number; k: number;
  FW: number; FH: number;
  /** Cull bounds in screen px (the raster may extend past the screen). */
  c0x: number; c0y: number; c1x: number; c1y: number;
}
export interface SRect { x: number; y: number; w: number; h: number }

export const sxv = (v: View, wx: number) => v.FW / 2 + (wx - v.x) * v.k;
export const syv = (v: View, wy: number) => v.FH / 2 + (wy - v.y) * v.k;
export function rs(v: View, o: Box, out?: SRect): SRect {
  const r = out ?? { x: 0, y: 0, w: 0, h: 0 };
  r.x = sxv(v, o.x); r.y = syv(v, o.y); r.w = o.w * v.k; r.h = o.h * v.k;
  return r;
}
export function onView(v: View, r: SRect, m = 0): boolean {
  return !(r.x > v.c1x + m || r.y > v.c1y + m || r.x + r.w < v.c0x - m || r.y + r.h < v.c0y - m);
}
/** The smallest box around every box in `bs`; null for none. */
export function union(bs: readonly Box[]): Box | null {
  if (!bs.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of bs) { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
export const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
