// The static layer cache. The plan (walls, fills, tiles, lens marks, labels) is rastered once into an
// offscreen bitmap that covers the viewport plus a margin, at the zoom of the moment (the "bucket").
// During a gesture the bitmap is only transformed (translate + scale, one drawImage per frame). It is
// re-rastered when the gesture settles, when the zoom leaves the bucket (x1.5 either way), when the ribbon/tile blend drifts by LOD_STEP, when the view
// leaves the covered area, or when anything static changes (lens mix, time, theme, filters...).
import type { Cam } from '../camera';
import type { SRect, View } from './view';

export const BUCKET = 1.5;
/** How far the live ribbon/tile blend may drift from the one baked into the bitmap before it is re-rastered (so a wheel zoom through the crossfade steps in at most 1/LOD_STEP rasters, never one jump). */
const LOD_STEP = 0.2;
const MARGIN = 0.22;
const MAX_PX = 12e6;
/** The screen canvas's device-pixel budget; the one place both the screen (Engine.fit) and the cache take their resolution from. */
const SCREEN_PX = 6.5e6;
/** The resolution authority: device px per CSS px for a w x h viewport. The screen canvas and the static cache both use exactly this. */
export function deviceRes(w: number, h: number, dpr: number): number {
  const r = Math.min(dpr || 1, 2);
  return w * h * r * r > SCREEN_PX ? Math.sqrt(SCREEN_PX / (w * h)) : r;
}

export class StaticCache {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cam: Cam | null = null; private lodAt = 0;
  private key = -1;
  private mx = 0; private my = 0; private res = 1;
  private cssW = 0; private cssH = 0; private FW = 0; private FH = 0;
  /** The view the bitmap was rastered with: a patch repaints with exactly it. */
  private view: View = { x: 0, y: 0, k: 1, FW: 0, FH: 0, c0x: 0, c0y: 0, c1x: 0, c1y: 0 };
  /** Stats for the perf report. */
  rasters = 0; lastMs = 0; patches = 0; lastPatchMs = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { alpha: true })!;
  }

  /** Is the cached bitmap usable at camera `c` for content `key`? 'exact' = no transform needed. */
  check(c: Cam, key: number, FW: number, FH: number, lod = this.lodAt): 'exact' | 'transform' | 'stale' {
    const o = this.cam;
    if (!o || key !== this.key || FW !== this.FW || FH !== this.FH) return 'stale';
    const r = c.k / o.k;
    if (r > BUCKET || r < 1 / BUCKET || Math.abs(lod - this.lodAt) > LOD_STEP) return 'stale';
    // covered world rect vs the current viewport
    const cx0 = o.x + (-this.mx - FW / 2) / o.k, cx1 = o.x + (FW + this.mx - FW / 2) / o.k;
    const cy0 = o.y + (-this.my - FH / 2) / o.k, cy1 = o.y + (FH + this.my - FH / 2) / o.k;
    const vx0 = c.x - FW / 2 / c.k, vx1 = c.x + FW / 2 / c.k, vy0 = c.y - FH / 2 / c.k, vy1 = c.y + FH / 2 / c.k;
    if (vx0 < cx0 - 0.5 / c.k || vx1 > cx1 + 0.5 / c.k || vy0 < cy0 - 0.5 / c.k || vy1 > cy1 + 0.5 / c.k) return 'stale';
    if (Math.abs(r - 1) < 1e-6 && Math.abs((c.x - o.x) * c.k) < 0.01 && Math.abs((c.y - o.y) * c.k) < 0.01) return 'exact';
    return 'transform';
  }

  /** Raster the static scene at camera `c`. `paint` draws in screen coordinates of that camera. */
  render(c: Cam, key: number, FW: number, FH: number, dpr: number, paint: (ctx: CanvasRenderingContext2D, v: View) => void, margin = MARGIN, lod = 0) {
    const t0 = performance.now();
    this.FW = FW; this.FH = FH;
    // the bitmap is always at the screen's resolution (1:1 at rest); the pan margin shrinks instead to bound memory (<= MAX_PX)
    this.res = dpr;
    const room = Math.max(0, (Math.sqrt(MAX_PX / (FW * FH * dpr * dpr)) - 1) / 2);
    const m = Math.min(margin, room);
    // margins are whole device px, so an exact draw lands on the pixel grid
    this.mx = Math.round(FW * m * dpr) / dpr; this.my = Math.round(FH * m * dpr) / dpr;
    this.cssW = FW + 2 * this.mx; this.cssH = FH + 2 * this.my;
    const pw = Math.round(this.cssW * this.res), ph = Math.round(this.cssH * this.res);
    if (this.canvas.width !== pw || this.canvas.height !== ph) { this.canvas.width = pw; this.canvas.height = ph; }
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pw, ph);
    ctx.setTransform(this.res, 0, 0, this.res, this.mx * this.res, this.my * this.res);
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'; ctx.globalAlpha = 1;
    const v = this.view;
    v.x = c.x; v.y = c.y; v.k = c.k; v.FW = FW; v.FH = FH; v.c0x = -this.mx; v.c0y = -this.my; v.c1x = FW + this.mx; v.c1y = FH + this.my;
    paint(ctx, v);
    this.cam = { x: c.x, y: c.y, k: c.k };
    this.key = key; this.lodAt = lod;
    this.rasters++;
    this.lastMs = performance.now() - t0;
  }

  /**
   * Repaint part of the bitmap in place: clear the first `n` rects (raster screen px; snapped outward to whole
   * device pixels, in place, so no edge is half-covered) and run `paint` with the raster's own view clipped to
   * them. `paint` must draw the whole plan: what lies under and over a rect is repainted with it.
   */
  patch(rects: SRect[], n: number, paint: (ctx: CanvasRenderingContext2D, v: View) => void) {
    if (!this.cam || !n) return;
    const t0 = performance.now(), ctx = this.ctx, r = this.res, mx = this.mx, my = this.my;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const q = rects[i];
      const x0 = Math.max(0, Math.floor((q.x + mx) * r)), y0 = Math.max(0, Math.floor((q.y + my) * r));
      const x1 = Math.min(this.canvas.width, Math.ceil((q.x + q.w + mx) * r)), y1 = Math.min(this.canvas.height, Math.ceil((q.y + q.h + my) * r));
      q.x = x0 / r - mx; q.y = y0 / r - my; q.w = Math.max(0, x1 - x0) / r; q.h = Math.max(0, y1 - y0) / r;
      ctx.clearRect(x0, y0, x1 - x0, y1 - y0); ctx.rect(x0, y0, x1 - x0, y1 - y0);
    }
    ctx.save(); ctx.clip();
    ctx.setTransform(r, 0, 0, r, mx * r, my * r);
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'; ctx.globalAlpha = 1;
    try { paint(ctx, this.view); } finally { ctx.restore(); }
    this.patches++;
    this.lastPatchMs = performance.now() - t0;
  }

  /** Draw the cached bitmap onto the screen context (in CSS px) for camera `c`. */
  draw(ctx: CanvasRenderingContext2D, c: Cam, clipW?: number, screenRes = this.res) {
    const o = this.cam; if (!o) return;
    const s = c.k / o.k, FW = this.FW, FH = this.FH;
    const dx = (-this.mx - FW / 2) * s + FW / 2 + (o.x - c.x) * c.k;
    const dy = (-this.my - FH / 2) * s + FH / 2 + (o.y - c.y) * c.k;
    const ex = Math.abs(s - 1) < 1e-6;
    if (clipW != null) { ctx.save(); ctx.beginPath(); ctx.rect(0, 0, clipW, FH); ctx.clip(); }
    // 1:1 device pixels only when nothing scales (zoom ratio 1 and the bitmap at the screen's resolution); any other ratio smooths
    const one = ex && Math.abs(this.res - screenRes) < 1e-6, r = this.res;
    ctx.imageSmoothingEnabled = !one;
    if (one) ctx.drawImage(this.canvas, Math.round(dx * r) / r, Math.round(dy * r) / r, this.canvas.width / r, this.canvas.height / r);
    else ctx.drawImage(this.canvas, dx, dy, this.cssW * s, this.cssH * s);
    ctx.imageSmoothingEnabled = true;
    if (clipW != null) ctx.restore();
  }
  invalidate() { this.key = -1; }
}
