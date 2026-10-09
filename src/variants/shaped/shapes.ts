// Tile outlines and the edge marks that ride on them. Every outline is a closed polygon whose extra
// vertices sit ON the plain rectangle at dominance 0 and move inward as the lens takes over, so the
// morph is continuous and the clip of the stage fill always matches the stroke. The amounts are capped
// in UI px (u) so the engine's text rows (id/evidence at the top, name, stamp at the foot, all inset 7u)
// stay clear of the reshaped edges at every zoom.
import type { Feature, LensId } from '@/lib/data';
import type { Theme, TileGeom } from '../types';

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

// --------------------------------------------------------------------------- dominance hand-off
// The engine gives `shape` the dominance d but gives `marks` only presence and expansion. Shape is
// always called just before the same tile's marks, so the dominant lens leaves d here for its own
// marks to pick up (and clear). Edge marks follow d, exactly like the outline they decorate.
const stash = { f: '', l: '' as LensId | '', d: 0 };
function put(l: LensId, f: Feature, d: number) { stash.f = f.id; stash.l = l; stash.d = d; }
export function takeD(l: LensId, f: Feature): number {
  if (stash.f === f.id && stash.l === l) { stash.f = ''; return stash.d; }
  return 0;
}

/** Outline box: the engine strokes plain tiles at a half-pixel inset; match it so d = 0 is identical. */
function box(t: TileGeom) { return { X: t.x + 0.5, Y: t.y + 0.5, W: t.w - 1, H: t.h - 1 }; }

// ------------------------------------------------------------------------------- business: ticket
/** Shallow side bites; their depth is the business value (1..5). */
export function ticketGeom(t: TileGeom, f: Feature, d: number) {
  const { X, Y, W, H } = box(t), u = t.u;
  const v = clamp(f.business.value, 1, 5);
  const depth = d * Math.min(H * 0.13, 7.2 * u) * (0.22 + (0.78 * (v - 1)) / 4);
  const c = Math.min(H * 0.3, 20 * u);
  return { X, Y, W, H, depth, c, cy: Y + H / 2 };
}
export function shapeTicket(p: Path2D, t: TileGeom, f: Feature, d: number) {
  put('business', f, d);
  const g = ticketGeom(t, f, d), { X, Y, W, H, depth, c, cy } = g;
  p.moveTo(X, Y); p.lineTo(X + W, Y);
  if (depth > 0.25) {
    const R = (c * c + depth * depth) / (2 * depth), al = Math.atan2(c, R - depth);
    p.lineTo(X + W, cy - c); p.arc(X + W + R - depth, cy, R, al - Math.PI, Math.PI - al, true);
    p.lineTo(X + W, Y + H); p.lineTo(X, Y + H);
    p.lineTo(X, cy + c); p.arc(X - R + depth, cy, R, al, -al, true);
  } else { p.lineTo(X + W, Y + H); p.lineTo(X, Y + H); }
  p.closePath();
}
export function edgeTicket(ctx: CanvasRenderingContext2D, t: TileGeom, f: Feature, d: number, col: string) {
  const { X, W, depth, c, cy } = ticketGeom(t, f, d);
  if (depth <= 0.25) return;
  const R = (c * c + depth * depth) / (2 * depth), al = Math.atan2(c, R - depth);
  ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.6, 2 * t.u); ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(X + W + R - depth, cy, R + 2.4 * t.u, al - Math.PI, Math.PI - al, true); ctx.stroke();
  ctx.beginPath(); ctx.arc(X - R + depth, cy, R + 2.4 * t.u, al, -al, true); ctx.stroke();
}

// ------------------------------------------------------------------------- security: cut corners
/** Corner cuts [TR, BR, BL] by data class; card data is cut deepest, public data not at all. */
export function cutGeom(t: TileGeom, f: Feature, d: number) {
  const { X, Y, W, H } = box(t), u = t.u, cls = f.security.dataClass;
  // the foot-right corner carries the depth (the evidence text sits top-right, the stamp foot-left)
  const m = d * Math.min(H * 0.3, W * 0.2, 24 * u), sm = Math.min(m * 0.5, 12 * u * d);
  const k = cls === 'payment' ? [sm, m, sm] : cls === 'personal' ? [sm, m * 0.68, 0] : cls === 'internal' ? [0, m * 0.36, 0] : [0, 0, 0];
  return { X, Y, W, H, tr: k[0], br: k[1], bl: k[2] };
}
export function shapeCut(p: Path2D, t: TileGeom, f: Feature, d: number) {
  put('security', f, d);
  const { X, Y, W, H, tr, br, bl } = cutGeom(t, f, d);
  p.moveTo(X, Y); p.lineTo(X + W - tr, Y); p.lineTo(X + W, Y + tr);
  p.lineTo(X + W, Y + H - br); p.lineTo(X + W - br, Y + H);
  p.lineTo(X + bl, Y + H); p.lineTo(X, Y + H - bl); p.closePath();
}
export function edgeCut(ctx: CanvasRenderingContext2D, t: TileGeom, f: Feature, d: number, col: string) {
  const { X, Y, W, H, tr, br, bl } = cutGeom(t, f, d), u = t.u, o = 2.8 * u * d;
  const se = f.security, open = se.review === 'pending' || se.review === 'not-started' || se.review === 'findings';
  ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.5, 1.8 * u); ctx.lineCap = 'butt';
  ctx.setLineDash(open ? [3 * u, 2.5 * u] : []);
  ctx.beginPath();
  // a second wall parallel to each cut, offset inward: a fire-rated corner
  const q = o * 1.414;
  if (tr > 2) { ctx.moveTo(X + W - tr - q, Y); ctx.lineTo(X + W, Y + tr + q); }
  if (br > 2) { ctx.moveTo(X + W, Y + H - br - q); ctx.lineTo(X + W - br - q, Y + H); }
  if (bl > 2) { ctx.moveTo(X + bl + q, Y + H); ctx.lineTo(X, Y + H - bl - q); }
  ctx.stroke(); ctx.setLineDash([]);
}

// --------------------------------------------------------------------- operations: pill and gauge
export function pillGeom(t: TileGeom, d: number) {
  const { X, Y, W, H } = box(t);
  return { X, Y, W, H, r: d * Math.min(H * 0.5, W * 0.25, 22 * t.u) };
}
export function shapePill(p: Path2D, t: TileGeom, f: Feature, d: number) {
  put('operations', f, d);
  const { X, Y, W, H, r } = pillGeom(t, d);
  p.moveTo(X + r, Y); p.lineTo(X + W - r, Y); p.arcTo(X + W, Y, X + W, Y + r, r);
  p.lineTo(X + W, Y + H - r); p.arcTo(X + W, Y + H, X + W - r, Y + H, r);
  p.lineTo(X + r, Y + H); p.arcTo(X, Y + H, X, Y + H - r, r);
  p.lineTo(X, Y + r); p.arcTo(X, Y, X + r, Y, r); p.closePath();
}
/** The gauge along the straight bottom edge: rollout of the live service (or a dotted staging run). */
export function edgeGauge(ctx: CanvasRenderingContext2D, t: TileGeom, f: Feature, d: number, col: string, th: Theme, rollout: number) {
  const { X, Y, W, H, r } = pillGeom(t, d), u = t.u, op = f.operations;
  const x0 = X + Math.max(r, 6 * u), x1 = X + W - Math.max(r, 6 * u), y = Y + H - 3.4 * u, len = x1 - x0;
  if (len < 8) return;
  const bh = Math.max(2.5, 3 * u);
  if (op.environment === 'production') {
    const pc = op.flag ? rollout / 100 : 1;
    ctx.fillStyle = th.alpha(col, 0.22); ctx.fillRect(x0, y - bh / 2, len, bh);
    ctx.fillStyle = col; ctx.fillRect(x0, y - bh / 2, len * pc, bh);
    // quarter ticks above the gauge
    ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.beginPath();
    for (let i = 1; i < 4; i++) { const xx = Math.round(x0 + (len * i) / 4) + 0.5; ctx.moveTo(xx, y - bh / 2 - 3 * u); ctx.lineTo(xx, y - bh / 2); }
    ctx.stroke();
    if (!op.alerting) { ctx.fillStyle = th.red; ctx.fillRect(x1 - bh, y - bh * 1.5, bh, bh * 3); }
  } else if (op.environment === 'staging' || op.environment === 'preview') {
    ctx.strokeStyle = col; ctx.lineWidth = bh * 0.7; ctx.setLineDash([bh * 0.7, bh * 1.6]); ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + len * (op.environment === 'staging' ? 0.5 : 0.25), y); ctx.stroke(); ctx.setLineDash([]);
  }
}

// --------------------------------------------------------------- development: brackets and spines
export function bracketGeom(t: TileGeom, d: number) {
  const { X, Y, W, H } = box(t), u = t.u;
  return { X, Y, W, H, b: d * Math.min(W * 0.04, 6.5 * u), s: Math.min(H * 0.3, 26 * u) };
}
export function shapeBracket(p: Path2D, t: TileGeom, f: Feature, d: number) {
  put('development', f, d);
  const { X, Y, W, H, b, s } = bracketGeom(t, d);
  p.moveTo(X, Y); p.lineTo(X + W, Y);
  p.lineTo(X + W, Y + s); p.lineTo(X + W - b, Y + s); p.lineTo(X + W - b, Y + H - s); p.lineTo(X + W, Y + H - s);
  p.lineTo(X + W, Y + H); p.lineTo(X, Y + H);
  p.lineTo(X, Y + H - s); p.lineTo(X + b, Y + H - s); p.lineTo(X + b, Y + s); p.lineTo(X, Y + s);
  p.closePath();
}
/** Left recess: progress spine (bottom up). Right recess: the share written by agents. */
export function edgeSpines(ctx: CanvasRenderingContext2D, t: TileGeom, f: Feature, d: number, col: string, th: Theme, progress: number) {
  const { X, Y, W, H, b, s } = bracketGeom(t, d), dv = f.development;
  if (b < 1.5) return;
  const len = H - 2 * s - 4 * t.u, y1 = Y + H - s - 2 * t.u, bw = Math.max(2, b * 0.62);
  if (len < 6) return;
  ctx.fillStyle = th.alpha(col, 0.22); ctx.fillRect(X + (b - bw) / 2, y1 - len, bw, len);
  ctx.fillStyle = col; const pl = (len * clamp(progress, 0, 100)) / 100; ctx.fillRect(X + (b - bw) / 2, y1 - pl, bw, pl);
  if (dv.aiAuthoredPct > 0) {
    const al = (len * dv.aiAuthoredPct) / 100, xr = X + W - b + (b - bw) / 2;
    const pat = th.pattern({ kind: 'hlines', size: 3, color: col, lw: 1.2 });
    ctx.fillStyle = pat ?? th.alpha(col, 0.6); ctx.fillRect(xr, y1 - al, bw, al);
    ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.strokeRect(xr + 0.5, y1 - len + 0.5, bw - 1, len - 1);
  }
}

// ---------------------------------------------------------------------- quality: checklist edge
/** The left edge becomes a column of checkbox notches, one per end-to-end test (capped by room). */
export function combGeom(t: TileGeom, f: Feature, d: number) {
  const { X, Y, W, H } = box(t), u = t.u, q = f.quality;
  const top = Y + Math.min(H * 0.18, 12 * u), bot = Y + H - Math.min(H * 0.14, 9 * u), room = bot - top;
  const pitch0 = Math.max(4.2 * u, 4), n = q.e2eTests > 0 ? Math.max(1, Math.min(q.e2eTests, Math.floor(room / pitch0))) : 0;
  const pitch = n ? room / n : 0, depth = d * Math.min(W * 0.04, 5 * u), nh = Math.min(pitch * 0.62, 5.5 * u);
  return { X, Y, W, H, top, n, pitch, depth, nh, pass: q.e2eTests ? Math.round((n * q.e2ePassing) / q.e2eTests) : 0 };
}
export function shapeComb(p: Path2D, t: TileGeom, f: Feature, d: number) {
  put('quality', f, d);
  const { X, Y, W, H, top, n, pitch, depth, nh } = combGeom(t, f, d);
  p.moveTo(X, Y); p.lineTo(X + W, Y); p.lineTo(X + W, Y + H); p.lineTo(X, Y + H);
  if (depth > 0.2) {
    for (let i = n - 1; i >= 0; i--) {
      const cy = top + pitch * (i + 0.5);
      p.lineTo(X, cy + nh / 2); p.lineTo(X + depth, cy + nh / 2); p.lineTo(X + depth, cy - nh / 2); p.lineTo(X, cy - nh / 2);
    }
  }
  p.closePath();
}
export function edgeComb(ctx: CanvasRenderingContext2D, t: TileGeom, f: Feature, d: number, col: string, th: Theme) {
  const { X, Y, H, top, n, pitch, depth, nh, pass } = combGeom(t, f, d), u = t.u;
  if (depth <= 1) return;
  if (!n) {
    // nothing to tick: a ruled margin with no boxes
    ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.setLineDash([2 * u, 2.5 * u]);
    ctx.beginPath(); ctx.moveTo(X + 3 * u * d, Y + H * 0.2); ctx.lineTo(X + 3 * u * d, Y + H * 0.8); ctx.stroke(); ctx.setLineDash([]);
    return;
  }
  ctx.fillStyle = col; ctx.beginPath();
  for (let i = 0; i < pass; i++) { const cy = top + pitch * (i + 0.5); ctx.rect(X + 0.8, cy - nh / 2 + 0.8, depth - 1.6, nh - 1.6); }
  ctx.fill();
  if (pass < n) {
    ctx.strokeStyle = f.quality.status === 'failing' ? th.red : col; ctx.lineWidth = 1; ctx.beginPath();
    for (let i = pass; i < n; i++) { const cy = top + pitch * (i + 0.5); ctx.rect(X + 1.2, cy - nh / 2 + 1.2, depth - 2.4, nh - 2.4); }
    ctx.stroke();
  }
}

// ----------------------------------------------------------------------- design: artboard + crops
const CROP: Record<string, number> = { sketch: 0.42, wireframe: 0.6, 'hi-fi': 0.8, implemented: 1, polished: 1 };
export function boardGeom(t: TileGeom, d: number) {
  const { X, Y, W, H } = box(t);
  return { X, Y, W, H, m: d * Math.min(H * 0.08, 4.6 * t.u) };
}
export function shapeBoard(p: Path2D, t: TileGeom, f: Feature, d: number) {
  put('design', f, d);
  const { X, Y, W, H, m } = boardGeom(t, d);
  p.rect(X + m, Y + m, W - 2 * m, H - 2 * m);
}
export function edgeCrops(ctx: CanvasRenderingContext2D, t: TileGeom, f: Feature, d: number, col: string, th: Theme) {
  const { X, Y, W, H, m } = boardGeom(t, d), u = t.u, de = f.design, k = CROP[de.status] ?? 0;
  if (m < 1 || !k) return;
  const g = 2 * u * d, len = (m + 5 * u) * k * d;
  const x0 = X + m, y0 = Y + m, x1 = X + W - m, y1 = Y + H - m;
  ctx.strokeStyle = de.a11y === 'fail' ? th.red : col; ctx.lineWidth = Math.max(1.2, 1.4 * u); ctx.lineCap = 'butt';
  ctx.setLineDash(de.status === 'sketch' || de.status === 'wireframe' ? [2.5 * u, 2 * u] : []);
  ctx.beginPath();
  ctx.moveTo(x0 - g, y0); ctx.lineTo(x0 - g - len, y0); ctx.moveTo(x0, y0 - g); ctx.lineTo(x0, y0 - g - len);
  ctx.moveTo(x1 + g, y0); ctx.lineTo(x1 + g + len, y0); ctx.moveTo(x1, y0 - g); ctx.lineTo(x1, y0 - g - len);
  ctx.moveTo(x0 - g, y1); ctx.lineTo(x0 - g - len, y1); ctx.moveTo(x0, y1 + g); ctx.lineTo(x0, y1 + g + len);
  ctx.moveTo(x1 + g, y1); ctx.lineTo(x1 + g + len, y1); ctx.moveTo(x1, y1 + g); ctx.lineTo(x1, y1 + g + len);
  ctx.stroke(); ctx.setLineDash([]);
  if (de.status === 'polished') {
    // registration target at the foot-right corner: the design is signed off
    const rr = Math.min(4 * u, m * 0.9), cx = x1 + m / 2 + g * 0.2, cy = y1 + m / 2 + g * 0.2;
    ctx.beginPath(); ctx.arc(cx, cy, rr, 0, 7); ctx.moveTo(cx - rr * 1.6, cy); ctx.lineTo(cx + rr * 1.6, cy); ctx.moveTo(cx, cy - rr * 1.6); ctx.lineTo(cx, cy + rr * 1.6); ctx.stroke();
  }
}
