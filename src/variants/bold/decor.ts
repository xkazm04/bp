// Bold's decoration under and around the plan, one family per lens, weighted by that lens's dominance (so
// it fades in as General gives way and always passes through nothing on a lens -> lens switch). It is
// drawn into the cached static raster, never per frame during a gesture.
//
// Three layers per lens:
//  1. a FIELD on the paper outside the buildings (ledger ruling, artboard dots, survey grid, graph paper,
//     a perimeter fence, a gauge ruler), clipped so it never runs under tiles or labels;
//  2. a RAIL in every bay header right of the bay tag (L2+): a dimension string, a ledger leader with
//     plain money words, a flow line of chevrons, a fence with a lock, a checklist, crop marks;
//  3. a TITLE BLOCK per building in the empty paper under its shorter wings (when one is big enough),
//     carrying the lens's sheet number and its building totals.
//
// Seam workaround: `decor(ctx, view, w, th)` gets the screen viewport but not the camera origin or the
// plan geometry, so this file reads the running engine from `window.__bp` (read-only). See NOTES.md for
// the seam change that would remove it.
import type { Engine } from '@/engine/Engine';
import { drawText } from '@/engine/text';
import { bl, type BuiltinLens } from '../base/legacy';
import { BH, G, TH, TW, isLiveSt, type BayNode, type BldNode, type RoomNode } from '@/lib/model';
import type { Theme, Viewport } from '../types';
import { CHANNELS, SENS, kUsd } from './channels';
import { LENS_NAME } from './palette';

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const TAU = Math.PI * 2;

interface Ctx2 {
  E: Engine; th: Theme; view: Viewport; k: number; u: number;
  /** Screen x/y of world 0,0. */
  ox: number; oy: number;
  accent: string;
  lens: BuiltinLens;
}
const sx = (P: Ctx2, wx: number) => P.ox + wx * P.k;
const sy = (P: Ctx2, wy: number) => P.oy + wy * P.k;

function engine(): Engine | null {
  if (typeof window === 'undefined') return null;
  const E = (window as unknown as { __bp?: Engine }).__bp;
  return E && E.M && E.th && E.cam ? E : null;
}

function onScreen(P: Ctx2, x: number, y: number, w: number, h: number, m = 0) {
  const v = P.view;
  return !(x > v.x + v.w + m || y > v.y + v.h + m || x + w < v.x - m || y + h < v.y - m);
}

/** Smallest world step (from a fixed ladder) that is at least `minPx` on screen. */
function ladder(k: number, minPx: number) {
  for (const s of [10, 20, 40, 80, 160, 400, 800, 1600, 4000, 8000]) if (s * k >= minPx) return s;
  return 16000;
}

/** Clip to the paper outside every building (even-odd against the building outlines). */
function clipOutside(ctx: CanvasRenderingContext2D, P: Ctx2) {
  const v = P.view, p = new Path2D();
  p.rect(v.x, v.y, v.w, v.h);
  const m = new DOMMatrix([P.k, 0, 0, P.k, P.ox, P.oy]);
  for (const B of P.E.M.L.blds) { const wp = P.E.wallPaths[B.i]; if (wp) p.addPath(wp.outline, m); }
  ctx.clip(p, 'evenodd');
}

// --------------------------------------------------------------------------------------- outlines
/** Outline vertices of a building in screen px (top edge, then the stepped bottom), clockwise. */
function outlinePts(P: Ctx2, B: BldNode): number[] {
  const raw: number[] = [B.x, B.y, B.x + B.w, B.y];
  for (let i = B.wings.length - 1; i >= 0; i--) { const W = B.wings[i]; raw.push(W.x + W.w, W.y + W.h, W.x, W.y + W.h); }
  const out: number[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    const x = sx(P, raw[i]), y = sy(P, raw[i + 1]), n = out.length;
    if (n && Math.abs(out[n - 2] - x) < 0.01 && Math.abs(out[n - 1] - y) < 0.01) continue;
    out.push(x, y);
  }
  // drop collinear points
  const pts: number[] = [], N = out.length / 2;
  for (let i = 0; i < N; i++) {
    const ax = out[((i - 1 + N) % N) * 2], ay = out[((i - 1 + N) % N) * 2 + 1], bx = out[i * 2], by = out[i * 2 + 1], cx = out[((i + 1) % N) * 2], cy = out[((i + 1) % N) * 2 + 1];
    if (Math.abs((bx - ax) * (cy - by) - (by - ay) * (cx - bx)) < 0.01) continue;
    pts.push(bx, by);
  }
  return pts;
}
/** The rectilinear outline pushed outward by d px. */
function offsetPath(pts: number[], d: number, into: CanvasPath) {
  const N = pts.length / 2; if (N < 3) return;
  let area = 0;
  for (let i = 0; i < N; i++) { const j = (i + 1) % N; area += pts[i * 2] * pts[j * 2 + 1] - pts[j * 2] * pts[i * 2 + 1]; }
  const s = area >= 0 ? 1 : -1;
  for (let i = 0; i < N; i++) {
    const p = (i - 1 + N) % N, n = (i + 1) % N;
    const x = pts[i * 2], y = pts[i * 2 + 1];
    let dx = x - pts[p * 2], dy = y - pts[p * 2 + 1], l = Math.hypot(dx, dy) || 1;
    const n1x = (s * dy) / l, n1y = (-s * dx) / l;
    dx = pts[n * 2] - x; dy = pts[n * 2 + 1] - y; l = Math.hypot(dx, dy) || 1;
    const n2x = (s * dy) / l, n2y = (-s * dx) / l;
    const ox = x + d * (n1x + n2x), oy = y + d * (n1y + n2y);
    if (i === 0) into.moveTo(ox, oy); else into.lineTo(ox, oy);
  }
  into.closePath();
}

// ------------------------------------------------------------------------------------------ caches
const aggCache = new Map<string, string[]>();
function bldParts(B: BldNode, lens: BuiltinLens): string[] {
  const key = B.id + '|' + B.feats.length + '|' + lens;
  let v = aggCache.get(key);
  if (!v) { v = CHANNELS[lens].aggregate(B.feats).parts; aggCache.set(key, v); }
  return v;
}
const roomSens = new Map<string, number>();
function sensOf(R: RoomNode) {
  let v = roomSens.get(R.id);
  if (v == null) { v = 0; for (const f of R.feats) v = Math.max(v, SENS[bl(f).security.dataClass] ?? 0); roomSens.set(R.id, v); }
  return v;
}

// -------------------------------------------------------------------------------------------- field
/** Screen rects of the wings on screen: field marks inside them are skipped (they would be clipped). */
const wr: number[] = [];
function wingRects(P: Ctx2): number[] {
  wr.length = 0;
  for (const B of P.E.M.L.blds) for (const W of B.wings) {
    const x = sx(P, W.x), y = sy(P, W.y), w = W.w * P.k, h = W.h * P.k;
    if (onScreen(P, x, y, w, h, 8)) wr.push(x - 6, y - 6, x + w + 6, y + h + 6);
  }
  return wr;
}
function inWing(r: number[], X: number, Y: number) {
  for (let i = 0; i < r.length; i += 4) if (X > r[i] && X < r[i + 2] && Y > r[i + 1] && Y < r[i + 3]) return true;
  return false;
}

function hRules(ctx: CanvasRenderingContext2D, P: Ctx2, step: number, every: number, a1: number, a2: number) {
  const v = P.view, k = P.k, w0 = Math.floor((v.y - P.oy) / k / step) * step;
  const minor = new Path2D(), major = new Path2D();
  for (let wy = w0; sy(P, wy) < v.y + v.h; wy += step) {
    const Y = Math.round(sy(P, wy)) + 0.5, p = Math.round(wy / step) % every === 0 ? major : minor;
    p.moveTo(v.x, Y); p.lineTo(v.x + v.w, Y);
  }
  ctx.lineWidth = 1;
  ctx.strokeStyle = P.th.alpha(P.accent, a1); ctx.stroke(minor);
  ctx.strokeStyle = P.th.alpha(P.accent, a2); ctx.stroke(major);
}
function vRules(ctx: CanvasRenderingContext2D, P: Ctx2, step: number, every: number, a1: number, a2: number) {
  const v = P.view, k = P.k, w0 = Math.floor((v.x - P.ox) / k / step) * step;
  const minor = new Path2D(), major = new Path2D();
  for (let wx = w0; sx(P, wx) < v.x + v.w; wx += step) {
    const X = Math.round(sx(P, wx)) + 0.5, p = Math.round(wx / step) % every === 0 ? major : minor;
    p.moveTo(X, v.y); p.lineTo(X, v.y + v.h);
  }
  ctx.lineWidth = 1;
  ctx.strokeStyle = P.th.alpha(P.accent, a1); ctx.stroke(minor);
  ctx.strokeStyle = P.th.alpha(P.accent, a2); ctx.stroke(major);
}

function field(ctx: CanvasRenderingContext2D, P: Ctx2) {
  const { th, u, k } = P;
  ctx.save();
  // ruled fields are clipped to the paper outside the buildings; point fields skip the wings themselves
  if (P.lens === 'business' || P.lens === 'quality' || P.lens === 'development') clipOutside(ctx, P);
  switch (P.lens) {
    case 'business': { // a ledger: ruled lines, every fifth one stronger
      hRules(ctx, P, ladder(k, 22 * u), 5, 0.2, 0.42);
      break;
    }
    case 'design': { // the design tool's canvas: a dot grid (one path of tiny squares, world-anchored)
      const st = ladder(k, 24 * u), v = P.view, d = Math.max(1.5, 1.6 * u);
      ctx.fillStyle = th.alpha(P.accent, 0.6);
      const x0 = Math.floor((v.x - P.ox) / k / st) * st, y0 = Math.floor((v.y - P.oy) / k / st) * st, rw = wingRects(P);
      for (let wx = x0; sx(P, wx) < v.x + v.w; wx += st) for (let wy = y0; sy(P, wy) < v.y + v.h; wy += st) {
        const X = Math.round(sx(P, wx)), Y = Math.round(sy(P, wy));
        if (!inWing(rw, X, Y)) ctx.fillRect(X - d / 2, Y - d / 2, d, d);
      }
      break;
    }
    case 'development': { // a survey grid with crosses at the stations
      const st = ladder(k, 46 * u);
      vRules(ctx, P, st, 1000, 0.12, 0.12); hRules(ctx, P, st, 1000, 0.12, 0.12);
      const v = P.view, x0 = Math.floor((v.x - P.ox) / k / st) * st, y0 = Math.floor((v.y - P.oy) / k / st) * st, c = 4 * u, cr = new Path2D(), rw = wingRects(P);
      for (let wx = x0; sx(P, wx) < v.x + v.w; wx += st) for (let wy = y0; sy(P, wy) < v.y + v.h; wy += st) {
        const X = Math.round(sx(P, wx)) + 0.5, Y = Math.round(sy(P, wy)) + 0.5;
        if (inWing(rw, X, Y)) continue;
        cr.moveTo(X - c, Y); cr.lineTo(X + c, Y); cr.moveTo(X, Y - c); cr.lineTo(X, Y + c);
      }
      ctx.strokeStyle = th.alpha(P.accent, 0.7); ctx.lineWidth = 1; ctx.stroke(cr);
      break;
    }
    case 'quality': { // graph paper
      const st = ladder(k, 16 * u);
      vRules(ctx, P, st, 5, 0.12, 0.3); hRules(ctx, P, st, 5, 0.12, 0.3);
      break;
    }
    case 'operations': { // a flow field: rows of chevrons running left to right, the way work ships
      const st = ladder(k, 56 * u), v = P.view, y0 = Math.floor((v.y - P.oy) / k / st) * st, c = 4 * u, gap = 44 * u, p = new Path2D(), rw = wingRects(P);
      for (let wy = y0, row = 0; sy(P, wy) < v.y + v.h; wy += st, row++) {
        const Y = sy(P, wy), off = (row % 2) * gap / 2 + (((P.ox % gap) + gap) % gap);
        for (let X = v.x + off; X < v.x + v.w; X += gap) { if (inWing(rw, X, Y)) continue; p.moveTo(X - c, Y - c); p.lineTo(X, Y); p.lineTo(X - c, Y + c); }
      }
      ctx.strokeStyle = th.alpha(P.accent, 0.42); ctx.lineWidth = 1.3; ctx.stroke(p);
      break;
    }
    default: break;
  }
  ctx.restore();
}

// --------------------------------------------------------------------------------- building pieces
function buildingOrnaments(ctx: CanvasRenderingContext2D, P: Ctx2, B: BldNode) {
  const { th, u, k, accent } = P;
  const x0 = sx(P, B.x), y0 = sy(P, B.y), x1 = sx(P, B.x + B.w), y1 = sy(P, B.y + B.h);
  ctx.strokeStyle = accent; ctx.fillStyle = accent; ctx.lineWidth = 1;
  switch (P.lens) {
    case 'business': { // the ledger's double margin rule down the left side
      const a = x0 - 12 * u, b = x0 - 16 * u;
      ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(a, y0 - 24 * u); ctx.lineTo(a, y1 + 12 * u); ctx.moveTo(b, y0 - 24 * u); ctx.lineTo(b, y1 + 12 * u); ctx.stroke();
      break;
    }
    case 'design': { // crop marks at the four corners of the building: the whole site is one artboard
      const g = 10 * u, L = 20 * u; ctx.lineWidth = 1.4; ctx.beginPath();
      for (const [cx, cy, dx, dy] of [[x0, y0, -1, -1], [x1, y0, 1, -1], [x0, y1, -1, 1], [x1, y1, 1, 1]] as const) {
        ctx.moveTo(cx + dx * g, cy); ctx.lineTo(cx + dx * (g + L), cy); ctx.moveTo(cx, cy + dy * g); ctx.lineTo(cx, cy + dy * (g + L));
      }
      ctx.stroke();
      break;
    }
    case 'development': { // a dimension string under every wing
      ctx.lineWidth = 1; ctx.beginPath();
      for (const W of B.wings) {
        const a = sx(P, W.x), b = sx(P, W.x + W.w), wy = sy(P, W.y + W.h), dy = wy + 9 * u;
        if (b - a < 30 * u) continue;
        ctx.moveTo(a, wy + 3 * u); ctx.lineTo(a, dy + 4 * u); ctx.moveTo(b, wy + 3 * u); ctx.lineTo(b, dy + 4 * u);
        ctx.moveTo(a, dy); ctx.lineTo(b, dy);
        ctx.moveTo(a - 3 * u, dy + 3 * u); ctx.lineTo(a + 3 * u, dy - 3 * u); ctx.moveTo(b - 3 * u, dy + 3 * u); ctx.lineTo(b + 3 * u, dy - 3 * u);
      }
      ctx.stroke();
      break;
    }
    case 'operations': { // a gauge ruler along every wing's foot, with a flow arrow at the end
      const st = 20 * k >= 5 ? 20 : 100;
      const minor = new Path2D(), major = new Path2D();
      for (const W of B.wings) {
        const wy = sy(P, W.y + W.h) + 3 * u;
        for (let wx = W.x; wx <= W.x + W.w + 0.1; wx += st) {
          const X = Math.round(sx(P, wx)) + 0.5, maj = Math.round(wx - W.x) % 100 === 0;
          (maj ? major : minor).moveTo(X, wy); (maj ? major : minor).lineTo(X, wy + (maj ? 8 : 4) * u);
        }
      }
      ctx.strokeStyle = th.alpha(accent, 0.55); ctx.stroke(minor); ctx.strokeStyle = accent; ctx.lineWidth = 1.3; ctx.stroke(major);
      const ay = y1 + 16 * u; ctx.beginPath(); ctx.moveTo(x0, ay); ctx.lineTo(x1 - 8 * u, ay); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x1, ay); ctx.lineTo(x1 - 9 * u, ay - 4.5 * u); ctx.lineTo(x1 - 9 * u, ay + 4.5 * u); ctx.closePath(); ctx.fill();
      break;
    }
    case 'security': { // a perimeter: a hatched band between a solid fence and a dashed outer fence
      const pts = outlinePts(P, B), d1 = 6 * u, d2 = 16 * u;
      const ring = new Path2D(); offsetPath(pts, d2, ring); offsetPath(pts, d1, ring);
      const pat = th.pattern({ kind: 'back', size: 7, color: th.alpha(accent, th.mode === 'dark' ? 0.7 : 0.7), lw: 1.1 });
      if (pat) { ctx.fillStyle = pat; ctx.fill(ring, 'evenodd'); }
      ctx.beginPath(); offsetPath(pts, d1, ctx); ctx.lineWidth = 1.6; ctx.stroke();
      ctx.beginPath(); offsetPath(pts, d2, ctx); ctx.setLineDash([10 * u, 5 * u]); ctx.lineWidth = 1.1; ctx.stroke(); ctx.setLineDash([]);
      break;
    }
    case 'quality': { // inspection stamps at the building's corners
      const r = 8 * u; ctx.lineWidth = 1.4;
      for (const [cx, cy] of [[x0 - 16 * u, y0 - 16 * u], [x1 + 16 * u, y0 - 16 * u]] as const) {
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx - r * 0.45, cy); ctx.lineTo(cx - r * 0.1, cy + r * 0.35); ctx.lineTo(cx + r * 0.45, cy - r * 0.35); ctx.stroke();
      }
      break;
    }
  }
}

/** Security: the rooms that hold card or personal data get a fence inside their walls. */
function roomFences(ctx: CanvasRenderingContext2D, P: Ctx2, B: BldNode) {
  const { k, u, accent } = P, ins = Math.max(3, 6 * k);
  if (8 * k < 2.5) return;
  for (const W of B.wings) for (const R of W.rooms) {
    const lv = sensOf(R); if (lv < 2) continue;
    const x = sx(P, R.x) + ins, y = sy(P, R.y) + ins, w = R.w * k - 2 * ins, h = R.h * k - 2 * ins;
    if (w < 60 * u || !onScreen(P, x, y, w, h, 10)) continue;
    ctx.strokeStyle = accent; ctx.lineWidth = 1.2; ctx.setLineDash(lv === 3 ? [] : [7, 4]);
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    if (lv === 3 && ins > 4) { ctx.setLineDash([7, 4]); ctx.strokeRect(x + 3.5, y + 3.5, w - 7, h - 7); }
    ctx.setLineDash([]);
  }
}

// ------------------------------------------------------------------------------------------- rails
interface Rail { x0: number; x1: number; cy: number; bx: number; by: number; bay: BayNode }
function bayRails(P: Ctx2, B: BldNode, fn: (r: Rail) => void) {
  const { E, k, u } = P, tx = E.tx;
  if (BH * k < 23 * u) return;
  const cf = tx.f(12, 500, true), nf = tx.f(13.5, 600);
  for (const W of B.wings) {
    if (!onScreen(P, sx(P, W.x), sy(P, W.y), W.w * k, W.h * k, 20)) continue;
    for (const R of W.rooms) {
      if (!onScreen(P, sx(P, R.x), sy(P, R.y), R.w * k, R.h * k, 20)) continue;
      for (const Bay of R.bays) {
        const x = sx(P, Bay.x), y = sy(P, Bay.y), w = Bay.w * k;
        if (!onScreen(P, x, y, w, BH * k, 10)) continue;
        const code = Bay.cap.id.replace(/-[A-Z]$/, ''), nm = Bay.cap.name.toUpperCase(), cnt = String(Bay.tiles.length);
        const cw = tx.w(code, cf) + 12 * u, nw = tx.w(nm, nf, 0.7) + 12 * u, kw = tx.w(cnt, cf) + 12 * u;
        let full = cw + nw + kw;
        if (full > w) full = nw <= w ? nw : 0;
        const th2 = 22 * u, ty = y + Math.max(1, (BH * k - th2) / 2 - 3);
        fn({ x0: x + full + 12 * u, x1: x + w, cy: ty + th2 / 2, bx: x, by: y, bay: Bay });
      }
    }
  }
}

function railText(ctx: CanvasRenderingContext2D, P: Ctx2, r: Rail, parts: string[], mono: boolean, reserve = 0): number {
  const tx = P.E.tx, font = mono ? tx.f(12.5, 600, true) : tx.f(13.5, 600);
  const room = r.x1 - r.x0 - reserve - 8 * P.u;
  if (room < 40 * P.u) return r.x1 - reserve;
  const s = tx.fit(parts, room, font); if (!s) return r.x1 - reserve;
  const w = tx.w(s, font), x = r.x1 - reserve - w;
  if (mono) { ctx.fillStyle = P.th.alpha(P.th.labelBg, 0.92); ctx.fillRect(x - 5 * P.u, r.cy - 9 * P.u, w + 10 * P.u, 18 * P.u); }
  ctx.textAlign = 'left'; drawText(ctx, s, x, r.cy + 4.5 * P.u, font, P.accent);
  return x - 5 * P.u;
}

function rail(ctx: CanvasRenderingContext2D, P: Ctx2, r: Rail) {
  const { th, u, k, accent } = P, fs = r.bay.feats;
  ctx.strokeStyle = accent; ctx.fillStyle = accent; ctx.lineWidth = 1;
  switch (P.lens) {
    case 'business': {
      const asks = fs.reduce((s, f) => s + (bl(f).business.customerRequests30d || 0), 0);
      const mrr = fs.reduce((s, f) => s + (bl(f).business.revenueLink === 'direct' ? bl(f).business.mrrImpactUsd || 0 : 0), 0);
      const parts = [asks + (asks === 1 ? ' customer ask' : ' customer asks'), ...(mrr ? [kUsd(mrr) + ' a month'] : [])];
      const end = railText(ctx, P, r, parts, false);
      if (end - r.x0 > 20 * u) { ctx.strokeStyle = th.alpha(accent, 0.75); ctx.lineWidth = 1.5; ctx.setLineDash([1.5, 4 * u]); ctx.beginPath(); ctx.moveTo(r.x0, r.cy + 3 * u); ctx.lineTo(end - 4 * u, r.cy + 3 * u); ctx.stroke(); ctx.setLineDash([]); }
      break;
    }
    case 'design': { // the bay's tile block becomes an artboard: crop marks at its corners
      const c = r.bay.room.wing.cols, rows = Math.ceil(r.bay.tiles.length / c);
      const x0 = r.bx, y0 = r.by + BH * k, x1 = r.bx + (c * TW + (c - 1) * G) * k, y1 = y0 + (rows * TH + (rows - 1) * G) * k;
      const g = Math.min(4 * u, 3 * k), L = Math.min(12 * u, 9 * k);
      if (L < 4) break;
      ctx.lineWidth = 1.2; ctx.beginPath();
      for (const [cx, cy, dx, dy] of [[x0, y0, -1, -1], [x1, y0, 1, -1], [x0, y1, -1, 1], [x1, y1, 1, 1]] as const) {
        ctx.moveTo(cx + dx * g, cy); ctx.lineTo(cx + dx * (g + L), cy); ctx.moveTo(cx, cy + dy * g); ctx.lineTo(cx, cy + dy * (g + L));
      }
      ctx.stroke();
      break;
    }
    case 'development': { // a dimension string over the bay's columns, with extension lines to the tiles
      const c = r.bay.room.wing.cols, n = Math.min(c, r.bay.tiles.length), ty = r.by + BH * k - 2 * u, dy = r.cy + 9 * u;
      const pr = fs.reduce((s, f) => s + (bl(f).development.openPRs || 0), 0), ur = fs.reduce((s, f) => s + (bl(f).development.humanReviewed === false ? 1 : 0), 0);
      const ai = Math.round(fs.reduce((s, f) => s + bl(f).development.aiAuthoredPct, 0) / Math.max(1, fs.length));
      const p = new Path2D();
      const xa = r.bx, xb = r.bx + (n * TW + (n - 1) * G) * k;
      if (dy < ty - 2) {
        p.moveTo(xa, dy); p.lineTo(xb, dy);
        for (let i = 0; i < n; i++) {
          for (const ex of [r.bx + i * (TW + G) * k, r.bx + (i * (TW + G) + TW) * k]) {
            p.moveTo(ex, dy - 3 * u); p.lineTo(ex, ty); p.moveTo(ex - 2.5 * u, dy + 2.5 * u); p.lineTo(ex + 2.5 * u, dy - 2.5 * u);
          }
        }
        ctx.strokeStyle = th.alpha(accent, 0.9); ctx.lineWidth = 1.2; ctx.stroke(p);
      }
      railText(ctx, P, r, [fs.length + ' FEAT', pr + ' PR', 'AI ' + ai + '%', ...(ur ? [ur + ' UNREVIEWED'] : [])], true);
      break;
    }
    case 'operations': { // a flow line of chevrons to a live count
      const live = fs.filter((f) => bl(f).operations.environment === 'production').length;
      let roll = 0, nf = 0; for (const f of fs) if (bl(f).operations.flag && isLiveSt(f.stage)) { roll += P.E.M.sim.rolloutOf(f); nf++; }
      const inc = fs.reduce((s, f) => s + (bl(f).operations.incidents30d || 0), 0);
      const parts = [live + '/' + fs.length + ' LIVE', ...(nf ? [Math.round(roll / nf) + '% OUT'] : []), ...(inc ? [inc + ' INC'] : [])];
      const end = railText(ctx, P, r, parts, true);
      const step = 16 * u, c = 3.5 * u, p = new Path2D();
      for (let x = r.x0 + c; x < end - 6 * u; x += step) { p.moveTo(x - c, r.cy - c); p.lineTo(x, r.cy); p.lineTo(x - c, r.cy + c); }
      ctx.strokeStyle = th.alpha(accent, 0.85); ctx.lineWidth = 1.4; ctx.stroke(p);
      break;
    }
    case 'security': { // a fence with a padlock, then what it guards
      const card = fs.filter((f) => bl(f).security.dataClass === 'payment').length, pers = fs.filter((f) => bl(f).security.dataClass === 'personal').length;
      const un = fs.filter((f) => (bl(f).security.dataClass === 'payment' || bl(f).security.dataClass === 'personal') && (bl(f).security.review === 'pending' || bl(f).security.review === 'not-started')).length;
      if (!card && !pers) { railText(ctx, P, r, ['NO SENSITIVE DATA'], true); break; }
      const end = railText(ctx, P, r, [...(card ? [card + ' CARD'] : []), ...(pers ? [pers + ' PERSONAL'] : []), ...(un ? [un + ' UNREVIEWED'] : [])], true);
      const lx = end - 9 * u, ly = r.cy;
      if (lx - r.x0 > 24 * u) {
        ctx.strokeStyle = th.alpha(accent, 0.8); ctx.lineWidth = 1.2; ctx.setLineDash([6 * u, 3 * u]); ctx.beginPath(); ctx.moveTo(r.x0, ly); ctx.lineTo(lx - 9 * u, ly); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = accent; ctx.fillRect(lx - 5 * u, ly - 1 * u, 10 * u, 8 * u);
        ctx.strokeStyle = accent; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(lx, ly - 1 * u, 3.4 * u, Math.PI, TAU); ctx.stroke();
      }
      break;
    }
    case 'quality': { // a checklist, one box per feature, and the e2e count
      const s = 11 * u, gap = 4 * u, n = Math.min(fs.length, 12), bw = n * (s + gap);
      if (r.x1 - r.x0 < bw + 20 * u) break;
      const bx0 = r.x1 - bw, y0 = r.cy - s / 2, ok = new Path2D(), bad = new Path2D();
      for (let i = 0; i < n; i++) {
        const f = fs[i], x = bx0 + i * (s + gap), q = bl(f).quality;
        ctx.strokeStyle = q.status === 'n/a' ? th.alpha(accent, 0.35) : accent; ctx.lineWidth = 1;
        if (q.status === 'untested') ctx.setLineDash([2, 2]);
        ctx.strokeRect(x + 0.5, y0 + 0.5, s - 1, s - 1); ctx.setLineDash([]);
        if (q.status === 'passed') { ok.moveTo(x + s * 0.2, y0 + s * 0.52); ok.lineTo(x + s * 0.42, y0 + s * 0.76); ok.lineTo(x + s * 0.82, y0 + s * 0.24); }
        else if (q.status === 'failing') { bad.moveTo(x + s * 0.22, y0 + s * 0.22); bad.lineTo(x + s * 0.78, y0 + s * 0.78); bad.moveTo(x + s * 0.78, y0 + s * 0.22); bad.lineTo(x + s * 0.22, y0 + s * 0.78); }
        else if (q.status === 'partial' || q.status === 'testing') { ok.moveTo(x + s * 0.25, y0 + s / 2); ok.lineTo(x + s * 0.75, y0 + s / 2); }
      }
      ctx.lineWidth = 1.6; ctx.strokeStyle = accent; ctx.stroke(ok); ctx.strokeStyle = th.red; ctx.stroke(bad);
      const t = fs.reduce((a, f) => a + bl(f).quality.e2eTests, 0), pp = fs.reduce((a, f) => a + bl(f).quality.e2ePassing, 0), p1 = fs.reduce((a, f) => a + bl(f).quality.openBugs.p1, 0);
      railText(ctx, P, r, [pp + '/' + t + ' E2E', ...(p1 ? [p1 + ' P1'] : [])], true, bw + 6 * u);
      break;
    }
  }
}

// ------------------------------------------------------------------------------------- title block
function titleBlock(ctx: CanvasRenderingContext2D, P: Ctx2, B: BldNode) {
  const { E, th, u, k, accent, lens } = P, tx = E.tx;
  const parts = bldParts(B, lens), nm = LENS_NAME[lens];
  const lh = 18 * u;
  let H = 40 * u + parts.length * lh * 2; // conservative (every line wrapped) while placing
  let W = 250 * u;
  // where: the largest empty paper under a shorter wing, else under the building when there is room
  let bx = 0, by = 0, ok = false, best = 0;
  for (const Wg of B.wings) {
    const gx = sx(P, Wg.x), gy = sy(P, Wg.y + Wg.h), gw = Wg.w * k, gh = (B.y + B.h - Wg.y - Wg.h) * k, ww = Math.min(250 * u, gw - 16 * u);
    if (ww >= 140 * u && gh >= H + 30 * u && gw * gh > best) { best = gw * gh; W = ww; bx = gx + (gw - W) / 2; by = gy + 20 * u; ok = true; }
  }
  if (!ok) return;
  const mono = lens === 'development' || lens === 'operations' || lens === 'security' || lens === 'quality';
  const font = mono ? tx.f(13, 500, true) : tx.f(14, 500), lx0 = bx + (lens === 'quality' ? 26 : 12) * u, tw = bx + W - 12 * u - lx0;
  const lines: string[] = [];
  for (const p of parts) {
    const t = (lens === 'development' ? '> ' : '') + p;
    const wr = tx.wrap(t, tw, font, 2);
    if (wr) { lines.push(wr[0]); if (wr[1]) lines.push((lens === 'development' ? '  ' : '') + wr[1]); }
  }
  H = 40 * u + lines.length * lh;
  if (!onScreen(P, bx, by, W, H)) return;
  // the frame, by lens: crop marks (design), a tag (quality), a rounded console (operations), a ruled box
  ctx.fillStyle = th.alpha(th.labelBg, 0.94);
  const frame = new Path2D();
  if (lens === 'operations') frame.roundRect(bx, by, W, H, 10 * u);
  else if (lens === 'quality') { const c = 12 * u; frame.moveTo(bx + c, by); frame.lineTo(bx + W, by); frame.lineTo(bx + W, by + H); frame.lineTo(bx + c, by + H); frame.lineTo(bx, by + H - c); frame.lineTo(bx, by + c); frame.closePath(); }
  else frame.rect(bx, by, W, H);
  ctx.fill(frame);
  ctx.strokeStyle = accent; ctx.lineWidth = 1.5;
  if (lens === 'design') {
    const g = 5 * u, L = 14 * u; ctx.beginPath();
    for (const [cx, cy, dx, dy] of [[bx, by, -1, -1], [bx + W, by, 1, -1], [bx, by + H, -1, 1], [bx + W, by + H, 1, 1]] as const) {
      ctx.moveTo(cx + dx * g, cy); ctx.lineTo(cx + dx * (g + L), cy); ctx.moveTo(cx, cy + dy * g); ctx.lineTo(cx, cy + dy * (g + L));
    }
    ctx.stroke();
  } else {
    ctx.stroke(frame);
    if (lens === 'business') { ctx.lineWidth = 1; ctx.strokeRect(bx + 3.5 * u, by + 3.5 * u, W - 7 * u, H - 7 * u); }
  }
  if (lens === 'quality') { ctx.beginPath(); ctx.arc(bx + 12 * u, by + H / 2, 4 * u, 0, TAU); ctx.stroke(); }
  // heading: sheet number and the reader's name; a header bar for the terminal, a seal for security
  const hy = by + 24 * u, lx = bx + (lens === 'quality' ? 26 : 12) * u;
  if (lens === 'development') { ctx.fillStyle = th.alpha(accent, 0.18); ctx.fillRect(bx + 1, by + 1, W - 2, 32 * u); }
  drawText(ctx, nm.no, lx, hy, tx.f(12, 600, true), accent);
  const hf = tx.f(14.5, 700, lens === 'development'), hw = bx + W - (lx + 54 * u) - (lens === 'security' ? 40 : lens === 'operations' ? 26 : 10) * u;
  const ht = tx.fit([(lens === 'development' ? '$ ' : '') + nm.title], hw, hf) ?? tx.fit([nm.title.split(' ')[0]], hw, hf);
  if (ht) drawText(ctx, ht, lx + 54 * u, hy, hf, th.inkHi);
  ctx.strokeStyle = th.alpha(accent, 0.6); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(bx + 8 * u, by + 33 * u); ctx.lineTo(bx + W - 8 * u, by + 33 * u); ctx.stroke();
  if (lens === 'security') {
    const cx = bx + W - 22 * u, cy = by + 17 * u, r = 11 * u;
    ctx.strokeStyle = accent; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke(); ctx.beginPath(); ctx.arc(cx, cy, r - 3 * u, 0, TAU); ctx.stroke();
    ctx.fillStyle = accent; ctx.fillRect(cx - 3.5 * u, cy - 1 * u, 7 * u, 5.5 * u); ctx.beginPath(); ctx.arc(cx, cy - 1 * u, 2.4 * u, Math.PI, TAU); ctx.stroke();
  }
  if (lens === 'operations') { ctx.fillStyle = th.mint; ctx.beginPath(); ctx.arc(bx + W - 16 * u, by + 18 * u, 4 * u, 0, TAU); ctx.fill(); }
  lines.forEach((l, i) => drawText(ctx, l, lx0, by + 33 * u + lh * (i + 1) - 2 * u, font, th.ink));
}

// ------------------------------------------------------------------------------------------- entry
export function makeDecor(lens: BuiltinLens) {
  return (ctx: CanvasRenderingContext2D, view: Viewport, w: number, th: Theme) => {
    const E = engine(); if (!E || w <= 0.01) return;
    const k = view.k, FW = view.w + 2 * view.x, FH = view.h + 2 * view.y;
    const P: Ctx2 = { E, th, view, k, u: view.u, ox: FW / 2 - E.cam.x * k, oy: FH / 2 - E.cam.y * k, accent: th.mode === 'dark' ? CHANNEL_ACCENT(lens).dark : CHANNEL_ACCENT(lens).light, lens };
    const ga = ctx.globalAlpha;
    ctx.globalAlpha = ga * clamp(w, 0, 1);
    ctx.textBaseline = 'alphabetic';
    field(ctx, P);
    for (const B of E.M.L.blds) {
      const bx = sx(P, B.x), by = sy(P, B.y);
      if (!onScreen(P, bx, by, B.w * k, B.h * k, 200 * P.u)) continue;
      buildingOrnaments(ctx, P, B);
      if (lens === 'security') roomFences(ctx, P, B);
      // rails and title blocks carry text: they join in the second half of the tween (fewer text draws per frame)
      if (w > 0.4) {
        ctx.globalAlpha = ga * clamp((w - 0.4) / 0.6, 0, 1);
        bayRails(P, B, (r) => rail(ctx, P, r));
        titleBlock(ctx, P, B);
        ctx.globalAlpha = ga * clamp(w, 0, 1);
      }
    }
    ctx.globalAlpha = ga;
  };
}
const CHANNEL_ACCENT = (l: BuiltinLens) => CHANNELS[l].accent!;

