import type { Box } from '@/lib/model';

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
export const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
