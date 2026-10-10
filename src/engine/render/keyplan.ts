// The key plan (minimap). Its rooms and swarm dots are cached in a small bitmap; each redraw only
// blits that and strokes the viewport rectangle.
import type { Engine } from '../Engine';

export class KeyPlan {
  private base = document.createElement('canvas');
  private key = '';
  W = 162; H = 72;
  private E: Engine; cv: HTMLCanvasElement;
  // Plain fields, not parameter properties: Node's type stripping (how scripts/*.ts run) cannot load those.
  constructor(E: Engine, cv: HTMLCanvasElement) { this.E = E; this.cv = cv; }
  scale() {
    const Wd = this.E.M.L.world, s = Math.min((this.W - 12) / Wd.w, (this.H - 10) / Wd.h);
    return { s, ox: (this.W - Wd.w * s) / 2 - Wd.x * s, oy: (this.H - Wd.h * s) / 2 - Wd.y * s };
  }
  private renderBase(res: number) {
    const E = this.E, th = E.th, m = this.scale(), c = this.base;
    c.width = Math.round(this.W * res); c.height = Math.round(this.H * res);
    const g = c.getContext('2d')!;
    g.setTransform(res, 0, 0, res, 0, 0); g.clearRect(0, 0, this.W, this.H);
    for (const R of E.M.L.rooms) {
      const cc = E.counts(R.id, R.feats), share = (cc.live + cc.flagged) / Math.max(1, cc.n);
      g.fillStyle = th.inkA(0.06 + share * 0.3); g.fillRect(R.x * m.s + m.ox, R.y * m.s + m.oy, R.w * m.s, R.h * m.s);
      const bad = E.isNow ? E.M.agg.healthOf(R.id, R.feats, 'general').bad : 0;
      if (bad) { g.fillStyle = th.alpha(th.red, Math.min(0.85, 0.35 + bad * 0.15)); g.fillRect(R.x * m.s + m.ox + R.w * m.s - 4, R.y * m.s + m.oy + 1, 3, 3); }
      g.strokeStyle = th.inkA(0.55); g.lineWidth = 0.6; g.strokeRect(R.x * m.s + m.ox, R.y * m.s + m.oy, R.w * m.s, R.h * m.s);
    }
    g.strokeStyle = th.ink; g.lineWidth = 1.2;
    for (const B of E.M.L.blds) g.strokeRect(B.x * m.s + m.ox, B.y * m.s + m.oy, B.w * m.s, B.h * m.s);
    const sim = E.M.sim;
    if (sim.has && E.isNow) {
      for (const a of sim.agents) {
        const T = E.M.L.TILE[a.f]; if (!T) continue;
        g.fillStyle = a.status === 'working' && !a.paused ? th.mint : a.status === 'waiting' ? th.amber : th.red;
        g.fillRect((T.x + T.w / 2) * m.s + m.ox - 1, (T.y + T.h / 2) * m.s + m.oy - 1, 2.4, 2.4);
      }
      g.fillStyle = th.amber;
      for (const d of sim.decisions) {
        if (!d.open) continue; const T = E.M.L.TILE[d.f]; if (!T) continue;
        g.beginPath(); g.moveTo((T.x + T.w) * m.s + m.ox, T.y * m.s + m.oy - 4); g.lineTo((T.x + T.w) * m.s + m.ox + 4, T.y * m.s + m.oy - 2); g.lineTo((T.x + T.w) * m.s + m.ox, T.y * m.s + m.oy); g.fill();
      }
    }
  }
  draw(baseKey: string, res: number) {
    const E = this.E, th = E.th, cv = this.cv;
    if (cv.width !== Math.round(this.W * res) || cv.height !== Math.round(this.H * res)) { cv.width = Math.round(this.W * res); cv.height = Math.round(this.H * res); this.key = ''; }
    const key = baseKey + '|' + this.W + 'x' + this.H + '|' + res;
    if (key !== this.key) { this.renderBase(res); this.key = key; }
    const g = cv.getContext('2d')!, m = this.scale(), c = E.cam, S = E.SAFE;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height); g.drawImage(this.base, 0, 0);
    g.setTransform(res, 0, 0, res, 0, 0);
    const vx = c.wx(S.l) * m.s + m.ox, vy = c.wy(S.t) * m.s + m.oy, vw = ((S.r - S.l) / c.k) * m.s, vh = ((S.b - S.t) / c.k) * m.s;
    g.fillStyle = th.alpha(th.amber, 0.14); g.fillRect(vx, vy, vw, vh);
    g.strokeStyle = th.amber; g.lineWidth = 1.4; g.strokeRect(vx, vy, vw, vh);
  }
  /** Click on the key plan -> world point. */
  toWorld(px: number, py: number) { const m = this.scale(); return { x: (px - m.ox) / m.s, y: (py - m.oy) / m.s }; }
}
