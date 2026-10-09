// The static layer cache. The plan (walls, fills, tiles, lens marks, labels) is rastered once into an
// offscreen bitmap that covers the viewport plus a margin, at the zoom of the moment (the "bucket").
// During a gesture the bitmap is only transformed (translate + scale, one drawImage per frame). It is
// re-rastered when the gesture settles, when the zoom leaves the bucket (x1.5 either way), when the view
// leaves the covered area, or when anything static changes (lens mix, time, theme, filters...).
import type { Cam } from '../camera';
import type { View } from './view';

export const BUCKET = 1.5;
const MARGIN = 0.22;
const MAX_PX = 12e6;

export class StaticCache {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cam: Cam | null = null;
  private key = '';
  private mx = 0; private my = 0; private res = 1;
  private cssW = 0; private cssH = 0; private FW = 0; private FH = 0;
  /** Stats for the perf report. */
  rasters = 0; lastMs = 0;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { alpha: true })!;
  }

  /** Is the cached bitmap usable at camera `c` for content `key`? 'exact' = no transform needed. */
  check(c: Cam, key: string, FW: number, FH: number): 'exact' | 'transform' | 'stale' {
    const o = this.cam;
    if (!o || key !== this.key || FW !== this.FW || FH !== this.FH) return 'stale';
    const r = c.k / o.k;
    if (r > BUCKET || r < 1 / BUCKET) return 'stale';
    // covered world rect vs the current viewport
    const cx0 = o.x + (-this.mx - FW / 2) / o.k, cx1 = o.x + (FW + this.mx - FW / 2) / o.k;
    const cy0 = o.y + (-this.my - FH / 2) / o.k, cy1 = o.y + (FH + this.my - FH / 2) / o.k;
    const vx0 = c.x - FW / 2 / c.k, vx1 = c.x + FW / 2 / c.k, vy0 = c.y - FH / 2 / c.k, vy1 = c.y + FH / 2 / c.k;
    if (vx0 < cx0 - 0.5 / c.k || vx1 > cx1 + 0.5 / c.k || vy0 < cy0 - 0.5 / c.k || vy1 > cy1 + 0.5 / c.k) return 'stale';
    if (Math.abs(r - 1) < 1e-6 && Math.abs((c.x - o.x) * c.k) < 0.01 && Math.abs((c.y - o.y) * c.k) < 0.01) return 'exact';
    return 'transform';
  }

  /** Raster the static scene at camera `c`. `paint` draws in screen coordinates of that camera. */
  render(c: Cam, key: string, FW: number, FH: number, dpr: number, paint: (ctx: CanvasRenderingContext2D, v: View) => void) {
    const t0 = performance.now();
    this.FW = FW; this.FH = FH;
    this.mx = Math.round(FW * MARGIN); this.my = Math.round(FH * MARGIN);
    this.cssW = FW + 2 * this.mx; this.cssH = FH + 2 * this.my;
    this.res = Math.min(dpr, Math.sqrt(MAX_PX / (this.cssW * this.cssH)));
    const pw = Math.round(this.cssW * this.res), ph = Math.round(this.cssH * this.res);
    if (this.canvas.width !== pw || this.canvas.height !== ph) { this.canvas.width = pw; this.canvas.height = ph; }
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pw, ph);
    ctx.setTransform(this.res, 0, 0, this.res, this.mx * this.res, this.my * this.res);
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'; ctx.globalAlpha = 1;
    paint(ctx, { x: c.x, y: c.y, k: c.k, FW, FH, c0x: -this.mx, c0y: -this.my, c1x: FW + this.mx, c1y: FH + this.my });
    this.cam = { x: c.x, y: c.y, k: c.k };
    this.key = key;
    this.rasters++;
    this.lastMs = performance.now() - t0;
  }

  /** Draw the cached bitmap onto the screen context (in CSS px) for camera `c`. */
  draw(ctx: CanvasRenderingContext2D, c: Cam, clipW?: number) {
    const o = this.cam; if (!o) return;
    const s = c.k / o.k, FW = this.FW, FH = this.FH;
    const dx = (-this.mx - FW / 2) * s + FW / 2 + (o.x - c.x) * c.k;
    const dy = (-this.my - FH / 2) * s + FH / 2 + (o.y - c.y) * c.k;
    const ex = Math.abs(s - 1) < 1e-6;
    if (clipW != null) { ctx.save(); ctx.beginPath(); ctx.rect(0, 0, clipW, FH); ctx.clip(); }
    ctx.imageSmoothingEnabled = !ex;
    ctx.drawImage(this.canvas, ex ? Math.round(dx) : dx, ex ? Math.round(dy) : dy, this.cssW * s, this.cssH * s);
    ctx.imageSmoothingEnabled = true;
    if (clipW != null) ctx.restore();
  }
  invalidate() { this.key = ''; }
}
