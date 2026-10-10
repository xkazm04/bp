// Camera: world <-> screen, fitting boxes into the free part of the screen, a smoothed wheel zoom and a
// fly-to driven by motion's animate() on a plain 0..1 progress value. Never touches React.
import { animate, type AnimationPlaybackControls } from 'motion';
import type { Box } from '@/lib/model';

export interface Cam { x: number; y: number; k: number }
export interface Region { l: number; t: number; r: number; b: number }
export interface Pad { t: number; r: number; b: number; l: number }

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const ease = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
const easeOut = (u: number) => 1 - Math.pow(1 - u, 3);

export class Camera {
  x = 0; y = 0; k = 0.3;
  FW = 1280; FH = 800;
  KMIN = 0.02; KMAX = 2.6;
  /** Wheel smoothing target: zoom toward k keeping world point (wx, wy) under screen point (px, py). */
  wz: { k: number; px: number; py: number; wx: number; wy: number } | null = null;
  private fly: AnimationPlaybackControls | null = null;
  flying = false;
  world: Box = { x: 0, y: 0, w: 1, h: 1 };
  reduced = false;
  // A plain field, not a parameter property: scripts/check-camera.ts loads this file under Node's type stripping.
  private onMove: () => void;
  constructor(onMove: () => void) { this.onMove = onMove; }

  sx(x: number) { return this.FW / 2 + (x - this.x) * this.k; }
  sy(y: number) { return this.FH / 2 + (y - this.y) * this.k; }
  wx(x: number) { return this.x + (x - this.FW / 2) / this.k; }
  wy(y: number) { return this.y + (y - this.FH / 2) / this.k; }

  /** Fit a world box into a screen region (with padding in px, already scaled by U). */
  fit(box: Box, pad: Pad, over: number, R: Region): Cam {
    const rx0 = R.l + pad.l, rx1 = R.r - pad.r, ry0 = R.t + pad.t, ry1 = R.b - pad.b;
    const rw = Math.max(80, rx1 - rx0), rh = Math.max(80, ry1 - ry0);
    const k = clamp(Math.min(rw / box.w, (rh / box.h) * (over || 1)), this.KMIN, this.KMAX), h = Math.min(box.h, rh / k);
    const sx = (rx0 + rx1) / 2, sy = (ry0 + ry1) / 2;
    return { x: box.x + box.w / 2 - (sx - this.FW / 2) / k, y: box.y + h / 2 - (sy - this.FH / 2) / k, k };
  }

  stopFly() { if (this.fly) { this.fly.stop(); this.fly = null; } this.flying = false; }

  set(c: Cam) { this.stopFly(); this.wz = null; this.x = c.x; this.y = c.y; this.k = clamp(c.k, this.KMIN, this.KMAX); this.clampToWorld(); this.onMove(); }

  /** Fly to a camera. Zooming in eases position early and scale late; long hops bump out a little. */
  flyTo(t: Cam, dur?: number) {
    this.wz = null;
    this.stopFly();
    const b = { x: t.x, y: t.y, k: clamp(t.k, this.KMIN, this.KMAX) };
    if (this.reduced || dur === 0) { this.x = b.x; this.y = b.y; this.k = b.k; this.clampToWorld(); this.onMove(); return; }
    const a = { x: this.x, y: this.y, k: this.k };
    const dist = (Math.hypot(b.x - a.x, b.y - a.y) * Math.min(a.k, b.k)) / this.FW, zr = Math.abs(Math.log(b.k / a.k));
    const ms = dur ?? clamp(520 + dist * 260 + zr * 170, 520, 1150), bump = clamp(dist * 0.45, 0, 0.9);
    const zin = b.k > a.k;
    this.flying = true;
    this.fly = animate(0, 1, {
      duration: ms / 1000, ease: 'linear',
      onUpdate: (u) => {
        const ec = zin ? easeOut(u) : ease(u), ez = zin ? ease(u) : easeOut(u);
        this.k = Math.exp(Math.log(a.k) + (Math.log(b.k) - Math.log(a.k)) * ez) / (1 + bump * Math.sin(Math.PI * u));
        this.x = a.x + (b.x - a.x) * ec; this.y = a.y + (b.y - a.y) * ec;
        this.clampToWorld();
        this.onMove();
      },
      onComplete: () => { this.x = b.x; this.y = b.y; this.k = b.k; this.clampToWorld(); this.flying = false; this.fly = null; this.onMove(); },
    });
  }

  zoomAt(px: number, py: number, f: number) {
    this.stopFly();
    const k0 = this.wz ? this.wz.k : this.k;
    this.wz = { k: clamp(k0 * f, this.KMIN, this.KMAX), px, py, wx: this.wx(px), wy: this.wy(py) };
    if (this.reduced) while (this.wz) this.stepWheel();
    this.onMove();
  }
  /** One step of the wheel smoothing; returns true while still moving. */
  stepWheel(): boolean {
    const wz = this.wz;
    if (!wz) return false;
    let nk = this.k + (wz.k - this.k) * 0.28;
    if (Math.abs(nk - wz.k) / wz.k < 0.003) nk = wz.k;
    this.k = nk; this.pin(wz.wx, wz.wy, wz.px, wz.py);
    if (nk === wz.k) this.wz = null;
    this.clampToWorld();
    return !!this.wz;
  }
  /** Zoom to k at once, keeping the world point under screen point (px, py) where it is (a pinch). */
  zoomTo(px: number, py: number, k: number) {
    const wx = this.wx(px), wy = this.wy(py);
    this.stopFly(); this.wz = null;
    this.k = clamp(k, this.KMIN, this.KMAX); this.pin(wx, wy, px, py);
    this.clampToWorld(); this.onMove();
  }
  /** Place the camera so world point (wx, wy) draws at screen point (px, py) at the current k. */
  private pin(wx: number, wy: number, px: number, py: number) { this.x = wx - (px - this.FW / 2) / this.k; this.y = wy - (py - this.FH / 2) / this.k; }
  panBy(dx: number, dy: number, from: Cam) { this.stopFly(); this.wz = null; this.x = from.x - dx / this.k; this.y = from.y - dy / this.k; this.clampToWorld(); this.onMove(); }
  clampToWorld() {
    const W = this.world, m = 120 / this.k;
    this.x = clamp(this.x, W.x - this.FW / 2 / this.k + m, W.x + W.w + this.FW / 2 / this.k - m);
    this.y = clamp(this.y, W.y - this.FH / 2 / this.k + m, W.y + W.h + this.FH / 2 / this.k - m);
  }
  get moving() { return !!this.wz || this.flying; }
  /** Within kTol (relative) of t's scale and px screen px of its centre: "still at home" for re-fits and Esc. */
  near(t: Cam, kTol: number, px: number): boolean {
    return Math.abs(this.k / t.k - 1) < kTol && Math.hypot(this.x - t.x, this.y - t.y) * this.k < px;
  }
}
