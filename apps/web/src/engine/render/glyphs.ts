// Small drawing primitives shared by the static and dynamic layers: survey marks (agents), RFI
// pennants (questions), revision clouds (trouble), stage strokes and the stage bar.
import type { Stage } from '@/lib/data';
import type { AgentState } from '@/lib/model';
import type { Theme } from '../theme';

export function cloud(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.moveTo(x, y);
  const edge = (x0: number, y0: number, x1: number, y1: number) => {
    const len = Math.hypot(x1 - x0, y1 - y0), n = Math.max(2, Math.round(len / (r * 2.2))), nx = (y1 - y0) / len, ny = -(x1 - x0) / len;
    for (let i = 1; i <= n; i++) {
      const ax = x0 + ((x1 - x0) * (i - 1)) / n, ay = y0 + ((y1 - y0) * (i - 1)) / n, bx = x0 + ((x1 - x0) * i) / n, by = y0 + ((y1 - y0) * i) / n;
      ctx.quadraticCurveTo((ax + bx) / 2 + nx * r * 1.5, (ay + by) / 2 + ny * r * 1.5, bx, by);
    }
  };
  edge(x, y, x + w, y); edge(x + w, y, x + w, y + h); edge(x + w, y + h, x, y + h); edge(x, y + h, x, y);
  ctx.closePath();
}

export function agentColor(th: Theme, st: AgentState): string {
  return st === 'working' ? th.mint : st === 'waiting' ? th.amber : st === 'paused' ? th.ink : th.red;
}

/** An agent as a survey mark. Working = mint dot with ticks; waiting = amber ring; blocked = red square. */
export function glyphAgent(ctx: CanvasRenderingContext2D, th: Theme, x: number, y: number, st: AgentState, s: number, alpha: number, spin: number, u: number) {
  const ga = ctx.globalAlpha;
  ctx.globalAlpha = ga * alpha; ctx.lineJoin = 'round';
  if (st === 'working') {
    ctx.fillStyle = th.mint; ctx.strokeStyle = th.glyphEdge; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, s, 0, 6.2832); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = th.mint; ctx.lineWidth = 1.3;
    const r0 = s + 1.8 * u, r1 = s + 4.2 * u;
    ctx.beginPath();
    for (let i = 0; i < 4; i++) { const an = spin + i * 1.5708, c = Math.cos(an), sn = Math.sin(an); ctx.moveTo(x + c * r0, y + sn * r0); ctx.lineTo(x + c * r1, y + sn * r1); }
    ctx.stroke();
  } else if (st === 'waiting') {
    ctx.fillStyle = th.alpha(th.glyphEdge, 0.85); ctx.strokeStyle = th.amber; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.arc(x, y, s + 0.5, 0, 6.2832); ctx.fill(); ctx.stroke();
    ctx.fillStyle = th.amber; ctx.beginPath(); ctx.arc(x, y, Math.max(1.3, s * 0.32), 0, 6.2832); ctx.fill();
  } else if (st === 'blocked') {
    ctx.fillStyle = th.red; ctx.strokeStyle = th.glyphEdge; ctx.lineWidth = 1.5;
    ctx.fillRect(x - s, y - s, s * 2, s * 2); ctx.strokeRect(x - s, y - s, s * 2, s * 2);
    ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(x - s * 0.55, y); ctx.lineTo(x + s * 0.55, y); ctx.stroke();
  } else if (st === 'failed') {
    ctx.fillStyle = th.alpha(th.glyphEdge, 0.9); ctx.strokeStyle = th.red; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, s + 0.5, 0, 6.2832); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - s * 0.5, y - s * 0.5); ctx.lineTo(x + s * 0.5, y + s * 0.5); ctx.moveTo(x + s * 0.5, y - s * 0.5); ctx.lineTo(x - s * 0.5, y + s * 0.5); ctx.stroke();
  } else {
    ctx.fillStyle = th.alpha(th.glyphEdge, 0.85); ctx.strokeStyle = th.inkA(0.7); ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.arc(x, y, s + 0.5, 0, 6.2832); ctx.fill(); ctx.stroke();
    ctx.fillStyle = th.inkA(0.85); ctx.fillRect(x - s * 0.42, y - s * 0.4, s * 0.28, s * 0.8); ctx.fillRect(x + s * 0.14, y - s * 0.4, s * 0.28, s * 0.8);
  }
  ctx.globalAlpha = ga;
}

/** A request for information pinned to its place: pole and pennant, with an optional count bubble. */
export function glyphPin(ctx: CanvasRenderingContext2D, th: Theme, x: number, y: number, urg: string, emphasised: boolean, s: number, count: number, ring: number, u: number, font: string) {
  let col = urg === 'high' ? th.red : th.amber, hgt = 19 * s * u, wd = 12 * s * u;
  if (!emphasised) { col = th.inkA(0.62); hgt *= 0.8; wd *= 0.8; }
  const ga = ctx.globalAlpha;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  if (ring) {
    const rr = 10 * u + ring * 14 * u;
    ctx.strokeStyle = col; ctx.globalAlpha = ga * (1 - ring) * 0.9; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y - hgt * 0.55, rr, 0, 6.2832); ctx.stroke(); ctx.globalAlpha = ga;
  }
  ctx.strokeStyle = th.glyphEdge; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - hgt); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x, y - hgt); ctx.lineTo(x + wd, y - hgt * 0.74); ctx.lineTo(x, y - hgt * 0.48); ctx.closePath(); ctx.stroke();
  ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - hgt); ctx.stroke();
  ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x, y - hgt); ctx.lineTo(x + wd, y - hgt * 0.74); ctx.lineTo(x, y - hgt * 0.48); ctx.closePath(); ctx.fill();
  if (count > 0) {
    const bx = x - 8 * u, by = y - hgt + 4 * u, br = 8.5 * u;
    ctx.fillStyle = emphasised ? th.inkHi : th.inkA(0.85); ctx.strokeStyle = th.glyphEdge; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(bx, by, br, 0, 6.2832); ctx.fill(); ctx.stroke();
    ctx.textAlign = 'center'; ctx.font = font; ctx.fillStyle = th.mode === 'dark' ? th.glyphEdge : th.paper; ctx.fillText(String(count), bx, by + 4.2 * u); ctx.textAlign = 'left';
  }
  ctx.lineCap = 'butt';
}

/** The base fill of a tile: its lifecycle stage. The same in every lens and every variant. */
export function stageFill(ctx: CanvasRenderingContext2D, th: Theme, st: Stage | null, x: number, y: number, w: number, h: number, rolloutPct: number, progressPct: number, now: boolean) {
  if (st === 'live') { ctx.fillStyle = th.inkA(0.22); ctx.fillRect(x, y, w, h); }
  else if (st === 'flagged') {
    const p = now ? rolloutPct : 50;
    ctx.fillStyle = th.inkA(0.3); ctx.fillRect(x, y, (w * p) / 100, h);
    ctx.strokeStyle = th.ink; ctx.lineWidth = 1; ctx.setLineDash([2, 2]);
    ctx.beginPath(); ctx.moveTo(x + (w * p) / 100, y); ctx.lineTo(x + (w * p) / 100, y + h); ctx.stroke(); ctx.setLineDash([]);
  } else if (st === 'in-review') { const p = th.pattern({ kind: 'cross', size: 5, color: th.inkA(0.55), lw: 0.8 }); if (p) { ctx.fillStyle = p; ctx.fillRect(x, y, w, h); } }
  else if (st === 'in-dev') {
    const p = th.pattern({ kind: 'diag', size: 7, color: th.inkA(0.6), lw: 1 }); if (p) { ctx.fillStyle = p; ctx.fillRect(x, y, w, h); }
    if (now) { const bh = Math.max(2, Math.min(5, h * 0.07)); ctx.fillStyle = th.ink; ctx.fillRect(x, y + h - bh, (w * progressPct) / 100, bh); }
  } else if (st === 'deprecated') {
    ctx.strokeStyle = th.inkA(0.8); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y + h); ctx.moveTo(x + w, y); ctx.lineTo(x, y + h); ctx.stroke();
  }
}

/** The outline style of a stage: solid when real, dashed when proposed, dotted when only an idea. */
export function stageStroke(ctx: CanvasRenderingContext2D, th: Theme, st: Stage | null, a: number, lw: number) {
  ctx.strokeStyle = th.ink; ctx.lineWidth = lw;
  if (!st) { ctx.globalAlpha = a * 0.35; ctx.setLineDash([1, 3]); }
  else if (st === 'specified') ctx.setLineDash([5, 3]);
  else if (st === 'idea') { ctx.setLineDash([1.5, 2.5]); ctx.globalAlpha = a * 0.8; }
  else ctx.setLineDash([]);
}

export interface BarCounts { live: number; flagged: number; build: number; paper: number; none: number; dep: number }
export function drawStageBar(ctx: CanvasRenderingContext2D, th: Theme, x: number, y: number, w: number, h: number, c: BarCounts) {
  const segs: [number, string | CanvasPattern | null][] = [
    [c.live, th.inkA(0.85)], [c.flagged, th.inkA(0.5)], [c.build, null], [c.paper + c.none, th.inkA(0.08)], [c.dep, th.alpha(th.red, 0.4)],
  ];
  const tot = segs.reduce((a, s) => a + s[0], 0) || 1;
  let xx = x;
  for (const [n, col] of segs) {
    const sw = (w * n) / tot; if (sw <= 0) continue;
    if (col == null) { ctx.fillStyle = th.inkA(0.12); ctx.fillRect(xx, y, sw, h); const p = th.pattern({ kind: 'diag', size: 7, color: th.inkA(0.6), lw: 1 }); if (p) { ctx.fillStyle = p; ctx.fillRect(xx, y, sw, h); } }
    else { ctx.fillStyle = col; ctx.fillRect(xx, y, sw, h); }
    xx += sw;
  }
  ctx.strokeStyle = th.inkA(0.55); ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}
export function drawHealthBar(ctx: CanvasRenderingContext2D, th: Theme, x: number, y: number, w: number, h: number, c: { good: number; watch: number; bad: number; na: number }) {
  const segs: [number, string][] = [[c.good, th.inkA(0.62)], [c.watch, th.amber], [c.bad, th.red], [c.na, th.inkA(0.12)]];
  const tot = segs.reduce((a, s) => a + s[0], 0) || 1;
  let xx = x;
  for (const [n, col] of segs) { const sw = (w * n) / tot; if (sw <= 0) continue; ctx.fillStyle = col; ctx.fillRect(xx, y, sw, h); xx += sw; }
  ctx.strokeStyle = th.inkA(0.55); ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}
