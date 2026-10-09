// The static plan: grid, wings, ribbons (L0/L1) and fixtures (L2+), walls and labels. Everything here
// is drawn into the cached raster (static-cache.ts), never per frame during a gesture. The lens mix is
// applied here: stage fills stay put, lens channels draw their marks into slots (General) or into the
// tile body (a lone lens), and text crossfades between the general and the dominant lens's content.
import type { Feature } from '@/lib/data';
import { EVIDENCE_BY_DENSITY } from '@/lib/standard/present';
import { BH, RH, TW, deltaWin, lensHealth, stageAt, stageParts, STAGE_WORD, isLiveSt, type BldNode, type TileNode, type WingNode } from '@/lib/model';
import type { Engine } from '../Engine';
import type { Rect, TileGeom } from '../lens/contract';
import { drawText } from '../text';
import { cloud, drawHealthBar, drawStageBar, glyphAgent, glyphPin, stageFill, stageStroke } from './glyphs';
import { onView, rs, smooth, sxv, syv, type SRect, type View } from './view';

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const scratch: SRect = { x: 0, y: 0, w: 0, h: 0 };

export function drawGrid(E: Engine, ctx: CanvasRenderingContext2D, v: View) {
  const k = v.k, th = E.th;
  for (const [step, a] of [[40, 0.045], [200, 0.09]] as const) {
    const sp = step * k; if (sp < 9) continue;
    ctx.strokeStyle = th.alpha(th.accent, a * clamp((sp - 9) / 12, 0, 1) * (th.mode === 'dark' ? 1 : 0.9)); ctx.lineWidth = 1; ctx.beginPath();
    const wx0 = v.x + (v.c0x - v.FW / 2) / k, wy0 = v.y + (v.c0y - v.FH / 2) / k;
    const x0 = Math.floor(wx0 / step) * step, y0 = Math.floor(wy0 / step) * step;
    for (let x = x0; sxv(v, x) < v.c1x; x += step) { const X = Math.round(sxv(v, x)) + 0.5; ctx.moveTo(X, v.c0y); ctx.lineTo(X, v.c1y); }
    for (let y = y0; syv(v, y) < v.c1y; y += step) { const Y = Math.round(syv(v, y)) + 0.5; ctx.moveTo(v.c0x, Y); ctx.lineTo(v.c1x, Y); }
    ctx.stroke();
  }
}

/** Variant decoration under the plan, weighted by each lens's dominance. */
export function drawDecor(E: Engine, ctx: CanvasRenderingContext2D, v: View) {
  const m = E.mixS;
  for (const l of E.lensIds) {
    const ch = E.channel(l);
    if (!ch || !ch.decor || m.d[l] <= 0.001) continue;
    ctx.save();
    ch.decor(ctx, { x: v.c0x, y: v.c0y, w: v.c1x - v.c0x, h: v.c1y - v.c0y, k: v.k, u: E.U }, m.d[l], E.th);
    ctx.restore();
  }
}

// ------------------------------------------------------------------------------------------- tiles
function makeGeom(E: Engine, x: number, y: number, w: number, h: number, form: 'ribbon' | 'tile', k: number): TileGeom {
  const u = E.U;
  const text = form === 'tile' && w >= 100 * u && h >= 44 * u;
  const strip: Rect = form === 'tile'
    ? { x: x + 6 * u, y: y + 3 * u, w: w - 12 * u, h: clamp(h * 0.07, 3 * u, 6 * u) }
    : { x, y, w, h: Math.min(3 * u, h * 0.2) };
  const body: Rect = form === 'tile' ? { x: x + 3 * u, y: y + 3 * u, w: w - 6 * u, h: h - 6 * u } : { x: x + 1, y: y + 1, w: Math.max(0, w - 2), h: Math.max(0, h - 2) };
  return { x, y, w, h, form, u, k, strip, body, text };
}

function generalEvidence(E: Engine, f: Feature, st: ReturnType<typeof stageAt>): string[] {
  if (!E.isNow || !st) return [st ? STAGE_WORD[st].toUpperCase() : 'NOT YET DRAWN'];
  const w = STAGE_WORD[st].toUpperCase(), L = E.live(f);
  if (st === 'flagged' && L.rolloutPct < 100) return [w, L.rolloutPct + '%'];
  if (st === 'in-dev') return [w, Math.round(L.progressPct) + '%'];
  return [w];
}
/**
 * General's stamp when a feature is in trouble (bad): the worst lens's reason with "+N" for the other
 * lenses in trouble; when that does not fit, the reason alone, then the rule's short form (with and
 * without "+N"), then the last candidate cut at a word, then the lens name with "+N".
 */
function generalStamp(E: Engine, f: Feature): { cands: string[]; last: string } | null {
  const t = f.trouble;
  if (!t.length || t[0].h !== 'bad') return null;
  const more = t.length > 1 ? ' +' + (t.length - 1) : '';
  const sh = t[0].short ? [t[0].short + more, t[0].short] : [];
  return { cands: [t[0].why + more, t[0].why, ...sh], last: (E.M.P.LENS[t[0].lens]?.name ?? t[0].lens) + more };
}
/** The first candidate that fits, else the last candidate cut at a word with an ellipsis (2+ words), else `last`. */
function fitStamp(E: Engine, cands: readonly string[], last: string | null, maxW: number, font: string): string | null {
  for (const c of cands) { const s = E.tx.fit([c], maxW, font); if (s) return s; }
  const words = (cands[cands.length - 1] ?? '').split(' ');
  for (let n = words.length - 1; n >= 2; n--) { const s = E.tx.fit([words.slice(0, n).join(' ').replace(/[,;:]$/, '') + '…'], maxW, font); if (s) return s; }
  return last ? E.tx.fit([last], maxW, font) : null;
}

function healthMarks(E: Engine, ctx: CanvasRenderingContext2D, h: string, x: number, y: number, w: number, hh: number, compact: boolean, a: number) {
  const u = E.U, th = E.th, ga = ctx.globalAlpha;
  ctx.globalAlpha = ga * a;
  if (compact) {
    if (h === 'bad') { ctx.fillStyle = th.red; ctx.fillRect(x, y - 3 * u, w, 3 * u); }
    else if (h === 'watch') { ctx.fillStyle = th.amber; ctx.fillRect(x, y - 3 * u, w, 2 * u); }
  } else if (h === 'bad') {
    ctx.strokeStyle = th.red; ctx.lineWidth = w < 40 * u ? 1.3 : 1.8; ctx.lineJoin = 'round';
    const r = clamp(w / 14, 2.4 * u, 6 * u); cloud(ctx, x - r * 0.8, y - r * 0.8, w + r * 1.6, hh + r * 1.6, r); ctx.stroke();
  } else if (h === 'watch' && w >= 22 * u) {
    ctx.strokeStyle = th.amber; ctx.lineWidth = 2; ctx.lineCap = 'round';
    const tx = x + w - 12 * u; ctx.beginPath(); ctx.moveTo(tx, y - 2); ctx.lineTo(tx + 4 * u, y - 7 * u); ctx.moveTo(tx + 5 * u, y - 2); ctx.lineTo(tx + 9 * u, y - 7 * u); ctx.stroke(); ctx.lineCap = 'butt';
  }
  ctx.globalAlpha = ga;
}

/** Lens channels on one tile or ribbon segment. */
function lensMarks(E: Engine, ctx: CanvasRenderingContext2D, g: TileGeom, f: Feature, st: ReturnType<typeof stageAt>) {
  const m = E.mixS, slots = E.expr.composeGeneral(g, E.lensIds), L = E.live(f), ga = ctx.globalAlpha, P = E.M.P;
  for (const l of E.lensIds) {
    const p = m.p[l];
    if (p <= 0.004) continue;
    const ch = E.channel(l); if (!ch) continue;
    const x = m.x[l], slot = slots[l] ?? null;
    const exp = E.expr.expandedRect ? E.expr.expandedRect(g, l) : g.body;
    let r: Rect, w: number;
    if (slot) { r = { x: lerp(slot.x, exp.x, x), y: lerp(slot.y, exp.y, x), w: lerp(slot.w, exp.w, x), h: lerp(slot.h, exp.h, x) }; w = p; }
    else { if (x <= 0.004) continue; r = exp; w = p * x; }
    if (r.w < 1 || r.h < 1) continue;
    ctx.save();
    ch.marks({ ctx, r, slot, lens: P.LENS[l], tile: g, f, w, x, compact: x < 0.5, th: E.th, stage: st, now: E.isNow, live: L, accent: E.accentOf(l) });
    ctx.restore();
    ctx.globalAlpha = ga;
  }
}

/** Outline path: the base rectangle, or the dominant lens's shape blended in by its dominance. */
function outline(E: Engine, g: TileGeom, f: Feature): Path2D | null {
  const top = E.mixS.top;
  if (!top || E.mixS.topD <= 0.001) return null;
  const ch = E.channel(top);
  if (!ch || !ch.shape) return null;
  const p = new Path2D();
  ch.shape(p, g, f, E.mixS.topD);
  return p;
}

function paintTile(E: Engine, ctx: CanvasRenderingContext2D, v: View, T: TileNode, alphaMul: number) {
  const f = T.f, u = E.U, th = E.th, k = v.k;
  const x = sxv(v, T.x), y = syv(v, T.y), w = T.w * k, h = T.h * k;
  if (x > v.c1x + 10 || y > v.c1y + 10 || x + w < v.c0x - 10 || y + h < v.c0y - 10) return;
  const S = E.S, now = E.isNow, st = stageAt(f, S.t, E.M.P.asOf);
  const a = (E.dimFn && !E.dimFn(f) ? 0.13 : 1) * alphaMul;
  if (a <= 0.01) return;
  ctx.globalAlpha = a;
  const g = makeGeom(E, x, y, w, h, 'tile', k);
  const shape = outline(E, g, f);
  if (shape) { ctx.save(); ctx.clip(shape); }
  ctx.fillStyle = th.tileBase; ctx.fillRect(x, y, w, h);
  if (S.blast) {
    if (E.M.P.F[S.blast].usedBy.includes(f.id)) { ctx.fillStyle = th.alpha(th.red, 0.5); ctx.fillRect(x, y, w, h); }
    else if (E.blastSet?.has(f.id)) { ctx.fillStyle = th.alpha(th.red, 0.22); ctx.fillRect(x, y, w, h); }
  }
  const Lv = E.live(f);
  stageFill(ctx, th, st, x, y, w, h, Lv.rolloutPct, Lv.progressPct, now);
  if (shape) ctx.restore();
  stageStroke(ctx, th, st, a, w < 30 * u ? 1 : 1.5);
  if (shape) ctx.stroke(shape); else ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.setLineDash([]); ctx.globalAlpha = a;
  if (S.blast === f.id) { ctx.strokeStyle = th.red; ctx.lineWidth = 3; ctx.strokeRect(x, y, w, h); }
  // trouble marks: general health crossfades into the dominant lens's health
  if (st && now) {
    const D = E.mixS.topD, top = E.mixS.top, hg = f.health, hl = top ? lensHealth(f, top) : hg;
    if (hg === hl || D <= 0.001) healthMarks(E, ctx, D > 0.999 ? hl : hg, x, y, w, h, false, 1);
    else { healthMarks(E, ctx, hg, x, y, w, h, false, 1 - D); healthMarks(E, ctx, hl, x, y, w, h, false, D); }
  }
  if (st && deltaWin(f, S.t, S.delta)) {
    const ds = clamp(w / 9, 4 * u, 8 * u); ctx.fillStyle = th.delta; ctx.beginPath();
    ctx.moveTo(x + w + 1, y - ds * 1.2); ctx.lineTo(x + w + 1 + ds * 0.7, y + ds * 0.3); ctx.lineTo(x + w + 1 - ds * 0.7, y + ds * 0.3); ctx.closePath(); ctx.fill();
  }
  lensMarks(E, ctx, g, f, st);
  ctx.globalAlpha = a;
  ctx.textBaseline = 'alphabetic';
  if (!g.text) { ctx.globalAlpha = 1; return; }
  const agentsHere = now && E.M.sim.has && E.M.sim.AGF[f.id] && E.M.sim.AGF[f.id].length;
  const chips = !!agentsHere && w >= 100 * u && h >= 58 * u;
  const tx = E.tx, D = E.mixS.topD, top = E.mixS.top;
  const hy = g.strip.y + g.strip.h + 12 * u;
  if (w >= 150 * u && h >= 64 * u) {
    const mono = tx.f(12, 500, true);
    const code = f.code, idw = code ? tx.w(code, mono) : -10 * u;
    // evidence: general (stage word) crossfading into the dominant lens's content
    const ev = generalEvidence(E, f, st);
    let lensC: { parts: string[]; stamp?: string } | null = null;
    const ch = top && D > 0.001 && now && st ? E.channel(top) : null;
    if (ch) {
      const c = ch.content(f, Lv);
      lensC = { parts: c.parts.slice(0, EVIDENCE_BY_DENSITY[ch.density]), stamp: c.stamp };
    }
    const evFont = (l: string | null) => (l && E.expr.evidenceFont?.(l) === 'sans' ? tx.f(13, 600) : mono);
    let showId = !!code;
    const room = w - 16 * u - idw - 10 * u;
    const gFit = tx.fit(ev, room, mono), lFit = lensC ? tx.fit(lensC.parts, room, evFont(top)) : null;
    if ((gFit == null && D < 0.5) || (lensC && lFit == null && D >= 0.5)) showId = false;
    if (showId) drawText(ctx, code, x + 7 * u, hy, mono, th.inkA(0.9));
    const roomW = showId ? room : w - 14 * u;
    ctx.textAlign = 'right';
    if (D < 0.999) { const s = showId ? gFit : tx.fit(ev, roomW, mono); if (s) { ctx.globalAlpha = a * (1 - D); drawText(ctx, s, x + w - 7 * u, hy, mono, th.ink); } }
    if (lensC && D > 0.001) { const s = showId ? lFit : tx.fit(lensC.parts, roomW, evFont(top)); if (s) { ctx.globalAlpha = a * D; drawText(ctx, s, x + w - 7 * u, hy, evFont(top), E.accentOf(top!)); } }
    ctx.textAlign = 'left'; ctx.globalAlpha = a;
    const gStamp = now && st ? generalStamp(E, f) : null, lStamp = lensC?.stamp ?? null;
    const stamp = D < 0.5 ? gStamp : lStamp;
    let ns = clamp(13.5 + (w / u - 150) / 60, 14, 17), lh = ns * 1.16 * u;
    const roomH = h - (hy - y) - 8 * u - (stamp ? 20 * u : 6 * u) - (chips ? 24 * u : 0);
    let nf = tx.f(ns, 500), lines = tx.wrap(f.name, w - 14 * u, nf, Math.max(1, Math.floor(roomH / lh)));
    if (!lines) { ns = 14; nf = tx.f(14, 500); lh = 16.2 * u; lines = tx.wrap(f.name, w - 14 * u, nf, Math.max(1, Math.floor(roomH / lh))); }
    if (lines) lines.forEach((l, i) => drawText(ctx, l, x + 7 * u, hy + 6 * u + lh * (i + 0.82), nf, th.inkHi));
    const sf = tx.f(12.5, 600), sy = y + h - 7 * u - (chips ? 22 * u : 0);
    if (gStamp && D < 0.999) { const s = fitStamp(E, gStamp.cands, gStamp.last, w - 14 * u, sf); if (s) { ctx.globalAlpha = a * (1 - D); drawText(ctx, s, x + 7 * u, sy, sf, th.red2, th.halo); } }
    if (lStamp && D > 0.001) { const s = fitStamp(E, [lStamp], null, w - 14 * u, sf); if (s) { ctx.globalAlpha = a * D; drawText(ctx, s, x + 7 * u, sy, sf, th.red2, th.halo); } }
  } else {
    const nf2 = tx.f(13, 500), l2 = 15 * u;
    const lines2 = tx.wrap(f.name, w - 12 * u, nf2, Math.max(1, Math.floor((h - 8 * u - (chips ? 22 * u : 0) - (hy - y - 12 * u)) / l2)));
    if (lines2) { const top2 = hy - 12 * u + (h - (hy - y - 12 * u) - lines2.length * l2 - (chips ? 20 * u : 0)) / 2; lines2.forEach((l, i) => drawText(ctx, l, x + 6 * u, top2 + l2 * (i + 0.78), nf2, th.inkHi)); }
  }
  ctx.globalAlpha = 1;
}

function ribSeg(E: Engine, ctx: CanvasRenderingContext2D, f: Feature, x: number, y: number, w: number, h: number, a0: number, k: number) {
  const S = E.S, th = E.th, st = stageAt(f, S.t, E.M.P.asOf);
  const aa = (E.dimFn && !E.dimFn(f) ? 0.13 : 1) * a0; if (aa <= 0.01) return;
  ctx.globalAlpha = aa;
  ctx.fillStyle = th.tileBase; ctx.fillRect(x, y, w, h);
  if (S.blast && (S.blast === f.id || E.blastSet?.has(f.id))) { ctx.fillStyle = th.alpha(th.red, 0.5); ctx.fillRect(x, y, w, h); }
  const Lv = E.live(f);
  stageFill(ctx, th, st, x, y, w, h, Lv.rolloutPct, Lv.progressPct, E.isNow);
  if (!st || st === 'specified' || st === 'idea') { stageStroke(ctx, th, st, aa, 1); ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); ctx.setLineDash([]); ctx.globalAlpha = aa; }
  if (st && E.isNow) {
    const D = E.mixS.topD, top = E.mixS.top, hg = f.health, hl = top ? lensHealth(f, top) : hg;
    if (hg === hl || D <= 0.001) healthMarks(E, ctx, D > 0.999 ? hl : hg, x, y, w, h, true, 1);
    else { healthMarks(E, ctx, hg, x, y, w, h, true, 1 - D); healthMarks(E, ctx, hl, x, y, w, h, true, D); }
  }
  if (st && deltaWin(f, S.t, S.delta)) {
    const ds = clamp((w * 0.9) / 9, 4 * E.U, 8 * E.U), xw = x + w * 0.9; ctx.fillStyle = th.delta; ctx.beginPath();
    ctx.moveTo(xw + 1, y - ds * 1.2); ctx.lineTo(xw + 1 + ds * 0.7, y + ds * 0.3); ctx.lineTo(xw + 1 - ds * 0.7, y + ds * 0.3); ctx.closePath(); ctx.fill();
  }
  lensMarks(E, ctx, makeGeom(E, x, y, w, h, 'ribbon', k), f, st);
  ctx.globalAlpha = 1;
}

function drawRibbons(E: Engine, ctx: CanvasRenderingContext2D, v: View, B: BldNode, alpha: number) {
  const k = v.k;
  for (const W of B.wings) {
    if (!onView(v, rs(v, W, scratch), 20)) continue;
    for (const R of W.rooms) {
      if (!onView(v, rs(v, R, scratch), 20)) continue;
      for (const Bay of R.bays) {
        const rb = Bay.rib, x = sxv(v, rb.x), y = syv(v, rb.y), w = rb.w * k, h = rb.h * k, n = Bay.tiles.length, sw = w / n;
        if (y > v.c1y + 10 || y + h < v.c0y - 10 || x > v.c1x + 10 || x + w < v.c0x - 10) continue;
        for (let i = 0; i < n; i++) ribSeg(E, ctx, Bay.tiles[i].f, x + i * sw + 1, y, sw - 2, h, alpha, k);
        ctx.globalAlpha = alpha * 0.55; ctx.strokeStyle = E.th.inkA(0.7); ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); ctx.globalAlpha = 1;
      }
    }
  }
}

function screenPath(world: Path2D, v: View): Path2D {
  const p = new Path2D();
  p.addPath(world, new DOMMatrix([v.k, 0, 0, v.k, v.FW / 2 - v.x * v.k, v.FH / 2 - v.y * v.k]));
  return p;
}

export function drawBuildings(E: Engine, ctx: CanvasRenderingContext2D, v: View) {
  const k = v.k, th = E.th, lod = E.lod(k);
  for (const B of E.M.L.blds) {
    const br = rs(v, B, scratch);
    if (!onView(v, br, 140)) continue;
    for (const W of B.wings) {
      const r = rs(v, W, scratch), c0 = E.counts(W.id, W.feats), sh = (c0.live + c0.flagged) / Math.max(1, c0.n);
      ctx.fillStyle = th.inkA(0.02 + 0.075 * sh); ctx.fillRect(r.x, r.y, r.w, r.h);
    }
    if (lod < 0.995) drawRibbons(E, ctx, v, B, 1 - lod);
    if (lod > 0.005) {
      for (const W of B.wings) {
        if (!onView(v, rs(v, W, scratch), 20)) continue;
        for (const R of W.rooms) {
          if (!onView(v, rs(v, R, scratch), 20)) continue;
          for (const Bay of R.bays) for (const T of Bay.tiles) paintTile(E, ctx, v, T, lod);
        }
      }
    }
    const paths = E.wallPaths[B.i];
    if (k > 0.12) { ctx.strokeStyle = th.inkA(0.5); ctx.lineWidth = 1; ctx.stroke(screenPath(paths.bays, v)); }
    const wi = clamp(6 * k, 1.2, 6), ww = clamp(10 * k, 2, 10), wo = clamp(18 * k, 3.5, 18);
    ctx.strokeStyle = th.ink; ctx.lineJoin = 'miter';
    ctx.lineWidth = wi; ctx.stroke(screenPath(paths.rooms, v));
    ctx.lineWidth = ww; ctx.stroke(screenPath(paths.wings, v));
    const out = screenPath(paths.outline, v);
    ctx.lineWidth = wo; ctx.stroke(out);
    if (wo > 6) { const p = th.pattern({ kind: 'diag', size: 5, color: th.inkA(0.75), lw: 1.1, bg: th.poche }); if (p) { ctx.lineWidth = wo - 4; ctx.strokeStyle = p; ctx.stroke(out); } }
  }
}

/** World-space wall geometry, built once per layout. */
export function buildWallPaths(E: Engine) {
  return E.M.L.blds.map((B) => {
    const rooms = new Path2D(), wings = new Path2D(), outline = new Path2D(), bays = new Path2D();
    for (const W of B.wings) { wings.rect(W.x, W.y, W.w, W.h); for (const R of W.rooms) rooms.rect(R.x, R.y, R.w, R.h); }
    outline.moveTo(B.x, B.y); outline.lineTo(B.x + B.w, B.y);
    for (let i = B.wings.length - 1; i >= 0; i--) { const W = B.wings[i]; outline.lineTo(W.x + W.w, W.y + W.h); outline.lineTo(W.x, W.y + W.h); }
    outline.closePath();
    for (const W of B.wings) for (const R of W.rooms) for (const Bay of R.bays) {
      if (Bay.y <= R.y + RH + 1) continue;
      bays.moveTo(R.x + 6, Bay.y - 2); bays.lineTo(R.x + R.w - 6, Bay.y - 2);
    }
    return { rooms, wings, outline, bays };
  });
}

// ------------------------------------------------------------------------------------------ labels
function aggParts(E: Engine, id: string, fs: readonly Feature[], short: boolean) {
  const c = E.counts(id, fs);
  const general = stageParts(c, short), generalShort = stageParts(c, true);
  const now = E.isNow;
  const gTrouble = now ? E.M.agg.healthOf(id, fs, 'general').bad : 0;
  const top = E.mixS.top, D = now ? E.mixS.topD : 0;
  let lens: string[] | null = null, lensShort: string[] | null = null, lTrouble = 0;
  if (top && D > 0.001) {
    const a = E.lensAgg(id, top, fs);
    lens = [c.n + (short ? '' : ' features'), ...a.parts];
    lensShort = [String(c.n), ...a.parts];
    lTrouble = a.trouble ?? E.M.agg.healthOf(id, fs, top).bad;
  }
  return { c, general, generalShort, lens, lensShort, gTrouble, lTrouble, D, top };
}

/** Text that crossfades between the general and the lens version at the same spot. */
function fadePair(ctx: CanvasRenderingContext2D, a: number, D: number, g: () => void, l: (() => void) | null) {
  const ga = ctx.globalAlpha;
  if (!l || D <= 0.001) { g(); return; }
  if (D < 0.999) { ctx.globalAlpha = a * (1 - D); g(); }
  ctx.globalAlpha = a * D; l();
  ctx.globalAlpha = ga;
}

function drawSwarmLine(E: Engine, ctx: CanvasRenderingContext2D, x: number, y: number, st: ReturnType<Engine['M']['sim']['stats']>, maxW: number): number {
  if (!E.M.sim.has || !st.n) return 0;
  const th = E.th, u = E.U, f = E.tx.f(13, 500, true);
  const items: [string, number, string][] = [['working', st.working, th.mintText], ['waiting', st.waiting, th.amberText], ['blocked', st.blocked + st.failed, th.red]];
  if (st.paused) items.push(['paused', st.paused, th.ink]);
  let gx = x, used = 0;
  for (const it of items) {
    if (!it[1]) continue;
    const w = 18 * u + E.tx.w(String(it[1]), f) + 8 * u;
    if (used + w > maxW) continue;
    glyphAgent(ctx, th, gx + 6 * u, y - 4 * u, (it[0] === 'blocked' && !st.blocked ? 'failed' : it[0]) as 'working', 4 * u, 1, 0, u);
    drawText(ctx, String(it[1]), gx + 15 * u, y, f, it[2], th.halo); gx += w; used += w;
  }
  return used;
}

/** Labels are always drawn in the cached layer; the intro reveals the whole raster with a wipe. */
function labelAlpha(_E: Engine) { return 1; }

function drawWingLabels(E: Engine, ctx: CanvasRenderingContext2D, v: View, B: BldNode): number {
  const k = v.k, u = E.U, th = E.th, tx = E.tx, sim = E.M.sim;
  const a0 = labelAlpha(E) * (E.M.P.scale > 1 ? smooth(E.KB1 * 0.62, E.KB1 * 0.8, k) : 1);
  const vis = B.wings.filter((W) => W.w * k >= 80 * u);
  if (!vis.length || a0 <= 0) return 0;
  let FS = 14, ML = 2;
  for (let f1 = 22; f1 >= 14 && ML === 2; f1--) if (vis.every((W) => tx.wrap(W.def.name.toUpperCase(), W.w * k - 34 * u, tx.f(f1, 600), 1, f1 * 0.05))) { FS = f1; ML = 1; }
  if (ML === 2) for (let f2 = 20; f2 >= 14; f2--) if (vis.every((W) => tx.wrap(W.def.name.toUpperCase(), W.w * k - 34 * u, tx.f(f2, 600), 2, f2 * 0.05))) { FS = f2; break; }
  let aMax = 0;
  for (const W of B.wings) {
    const a = clamp((W.w * k - 80 * u) / 10, 0, 1) * a0; if (a <= 0) continue;
    aMax = Math.max(aMax, a); ctx.globalAlpha = a;
    const r = rs(v, W, scratch); if (r.x > v.c1x || r.x + r.w < v.c0x) continue;
    const base = r.y - 10 * u, x = r.x + 6 * u, wdt = r.w - 14 * u;
    if (base < v.c0y - 10 || base > v.c1y + 120) continue;
    const ag = aggParts(E, W.id, W.feats, false);
    fadePair(ctx, a, ag.D, () => drawStageBar(ctx, th, x, base - 6 * u, wdt, 7 * u, ag.c), ag.lens ? () => drawHealthBar(ctx, th, x, base - 6 * u, wdt, 7 * u, E.M.agg.healthOf(W.id, W.feats, ag.top!)) : null);
    const af = tx.f(13, 500), tf = tx.f(13, 600);
    const line = (parts: string[], shortParts: string[], trouble: number, col: string) => () => {
      const tr = trouble ? tx.w(trouble + ' in trouble', tf) + 10 * u : 0;
      let s = tx.fit(parts, wdt - tr, af);
      if (s && !s.includes('·')) s = tx.fit(shortParts, wdt - tr, af) ?? s;
      if (s) drawText(ctx, s, x, base - 14 * u, af, col, th.halo);
      if (trouble) { ctx.textAlign = 'right'; drawText(ctx, trouble + ' in trouble', x + wdt, base - 14 * u, tf, th.red2, th.halo); ctx.textAlign = 'left'; }
    };
    fadePair(ctx, a, ag.D, line(ag.general, ag.generalShort, ag.gTrouble, th.ink), ag.lens ? line(ag.lens, ag.lensShort!, ag.lTrouble, E.accentOf(ag.top!)) : null);
    ctx.globalAlpha = a;
    const sy = base - 32 * u, ss = sim.has && E.isNow ? E.statsOf(W.id, W.feats) : null;
    if (ss && ss.n) {
      const focus = E.S.who || E.S.view !== 'general', em = focus ? ss.mine : ss.asks, shown = em > 0 ? em : ss.asks;
      const askW = ss.asks ? tx.w(String(shown), tx.f(13, 600, true)) + 26 * u : 0;
      drawSwarmLine(E, ctx, x, sy, ss, wdt - askW);
      if (ss.asks) {
        glyphPin(ctx, th, x + wdt - askW + 8 * u, sy + 4 * u, ss.high && em > 0 ? 'high' : 'med', em > 0, 0.62, 0, 0, u, tx.f(12, 600, true));
        drawText(ctx, String(shown), x + wdt - askW + 22 * u, sy, tx.f(13, 600, true), em > 0 ? (ss.high ? th.red2 : th.amberText) : th.inkA(0.75), th.halo);
      }
    }
    const nm = W.def.name.toUpperCase();
    let fs = FS, lines = tx.wrap(nm, W.w * k - 34 * u, tx.f(fs, 600), ML, fs * 0.05), bub = true;
    const ly = base - (ss && ss.n ? 56 : 38) * u;
    if (!lines) { fs = 12.5; lines = tx.wrap(nm, wdt, tx.f(fs, 600), 2, 0.5); bub = false; }
    if (bub) {
      ctx.beginPath(); ctx.arc(x + 11 * u, ly - 7 * u, 11 * u, 0, 7); ctx.fillStyle = th.labelBg; ctx.fill(); ctx.strokeStyle = th.ink; ctx.lineWidth = 1.3; ctx.stroke();
      ctx.textAlign = 'center'; drawText(ctx, W.def.letter, x + 11 * u, ly - 2.5 * u, tx.f(13, 500, true), th.ink); ctx.textAlign = 'left';
    }
    if (lines) lines.slice().reverse().forEach((l, i) => drawText(ctx, l, x + (bub ? 28 : 0) * u, ly - i * fs * 1.1 * u, tx.f(fs, 600), th.inkHi, th.halo, bub ? fs * 0.05 : 0.5));
  }
  ctx.globalAlpha = 1;
  return aMax;
}

function drawBuildingLabel(E: Engine, ctx: CanvasRenderingContext2D, v: View, B: BldNode, wingA: number) {
  if (E.M.P.scale === 1) return;
  const r = rs(v, B, scratch), u = E.U, th = E.th, tx = E.tx;
  if (r.w < 150 * u || !onView(v, r, 200)) return;
  const base = r.y - 12 * u - (wingA > 0 ? 112 * u * wingA : 0), a = labelAlpha(E);
  ctx.globalAlpha = a;
  const wdt = Math.min(r.w, 560 * u), ag = aggParts(E, B.id, B.feats, false), x = r.x;
  fadePair(ctx, a, ag.D, () => drawStageBar(ctx, th, x, base - 6 * u, wdt, 8 * u, ag.c), ag.lens ? () => drawHealthBar(ctx, th, x, base - 6 * u, wdt, 8 * u, E.M.agg.healthOf(B.id, B.feats, ag.top!)) : null);
  const f14 = tx.f(14, 500), f14b = tx.f(14, 600);
  const line = (parts: string[], trouble: number, col: string) => () => {
    const s = tx.fit(parts, wdt - 90 * u, f14); if (s) drawText(ctx, s, x, base - 15 * u, f14, col, th.halo);
    if (trouble) { ctx.textAlign = 'right'; drawText(ctx, trouble + ' in trouble', x + wdt, base - 15 * u, f14b, th.red2, th.halo); ctx.textAlign = 'left'; }
  };
  fadePair(ctx, a, ag.D, line(ag.general, ag.gTrouble, th.ink), ag.lens ? line(ag.lens, ag.lTrouble, E.accentOf(ag.top!)) : null);
  ctx.globalAlpha = a;
  const ss = E.M.sim.has && E.isNow ? E.statsOf(B.id, B.feats) : null, sy = base - 36 * u;
  if (ss && ss.n) {
    const used = drawSwarmLine(E, ctx, x, sy, ss, wdt);
    if (ss.asks) { glyphPin(ctx, th, x + used + 14 * u, sy + 4 * u, ss.high ? 'high' : 'med', true, 0.65, 0, 0, u, tx.f(12, 600, true)); drawText(ctx, ss.asks + ' questions waiting', x + used + 30 * u, sy, tx.f(13, 500, true), th.amberText, th.halo); }
  }
  const nm = B.name.toUpperCase(), fs = clamp(r.w / 14 / u, 18, 30);
  drawText(ctx, nm, x, base - (ss && ss.n ? 58 : 38) * u, tx.f(fs, 600), th.inkHi, th.halo, fs * 0.06);
  ctx.globalAlpha = 1;
}

function drawRoomLabels(E: Engine, ctx: CanvasRenderingContext2D, v: View, B: BldNode) {
  const k = v.k, u = E.U, th = E.th, tx = E.tx, hasSw = E.M.sim.has;
  for (const W of B.wings) {
    const a = clamp((W.w * k - 100 * u) / 8, 0, 1) * labelAlpha(E) * (E.M.P.scale > 1 ? smooth(E.KB1 * 0.62, E.KB1 * 0.8, k) : 1);
    if (a <= 0) continue;
    for (const R of W.rooms) {
      const r = rs(v, R, scratch); if (!onView(v, r)) continue;
      ctx.globalAlpha = a;
      const hh = RH * k, nm = R.d.name.toUpperCase(), maxW = r.w - 28 * u - (hasSw ? 38 * u : 0);
      let fs = clamp((hh * 0.36) / u, 14, 26), ls = fs * 0.06, lines = tx.wrap(nm, maxW, tx.f(fs, 600), 2, ls);
      if (!lines && fs > 14) { fs = 14; ls = 0.8; lines = tx.wrap(nm, maxW, tx.f(14, 600), 2, ls); }
      if (!lines) { ctx.globalAlpha = 1; R.labelRight = r.x; continue; }
      const lh = fs * 1.08 * u, blockH = lines.length * lh, inHeader = hh >= blockH + 14 * u;
      const topLimit = Math.max(v.c0y, E.SAFE.t) + 8 * u;
      const x = r.x + 14 * u;
      let y = Math.max(r.y + 8 * u, Math.min(topLimit, r.y + r.h - blockH - 30 * u));
      if (y > r.y + 8 * u && !inHeader) y = r.y + 8 * u;
      const pw = Math.max(...lines.map((l) => tx.w(l, tx.f(fs, 600), ls)));
      if (!inHeader || y > r.y + 8 * u) { ctx.fillStyle = th.alpha(th.labelBg, 0.92); ctx.fillRect(x - 6 * u, y - 3 * u, pw + 12 * u, blockH + 8 * u); }
      R.labelRight = x + pw + 6 * u;
      lines.forEach((l, i) => drawText(ctx, l, x, y + lh * (i + 0.8), tx.f(fs, 600), th.inkHi, null, ls));
      if (inHeader && hh >= blockH + 34 * u && y === r.y + 8 * u) {
        const ag = aggParts(E, R.id, R.feats, false), af = tx.f(13, 500);
        const avail = (trouble: number) => r.w - 28 * u - (trouble ? 92 * u : 0) - (r.w > 420 * u && hh > 70 * u ? 110 * u : 0) - (hasSw ? 38 * u : 0);
        const line = (parts: string[], trouble: number, col: string) => () => {
          const s = tx.fit(parts, avail(trouble), af);
          if (s) drawText(ctx, s, x, y + blockH + 17 * u, af, col);
          if (trouble && s) drawText(ctx, trouble + ' in trouble', x + tx.w(s, af) + 12 * u, y + blockH + 17 * u, tx.f(13, 600), th.red2);
        };
        fadePair(ctx, a, ag.D, line(ag.general, ag.gTrouble, th.inkA(0.8)), ag.lens ? line(ag.lens, ag.lTrouble, E.accentOf(ag.top!)) : null);
      }
      const art = E.art[R.d.base];
      if (art && art.complete && art.naturalWidth && r.w > 420 * u && hh > 70 * u) { const ah = hh - 14 * u, aw = ah * 1.5; ctx.globalAlpha = a * 0.5; ctx.drawImage(art, r.x + r.w - aw - 52 * u, r.y + 7 * u, aw, ah); }
      ctx.globalAlpha = 1;
    }
  }
}

function drawBayTags(E: Engine, ctx: CanvasRenderingContext2D, v: View, B: BldNode) {
  const k = v.k, u = E.U, th = E.th, tx = E.tx;
  if (BH * k < 23 * u) return;
  const a = clamp((BH * k - 23 * u) / 2, 0, 1) * labelAlpha(E);
  const cf = tx.f(12, 500, true), nf = tx.f(13.5, 600);
  ctx.globalAlpha = a;
  for (const W of B.wings) for (const R of W.rooms) for (const Bay of R.bays) {
    const r = rs(v, Bay, scratch); if (!onView(v, r)) continue;
    const code = Bay.cap.code, nm = Bay.cap.name.toUpperCase();
    const cw = tx.w(code, cf) + 12 * u, nw = tx.w(nm, nf, 0.7) + 12 * u, cnt = String(Bay.tiles.length), kw = tx.w(cnt, cf) + 12 * u;
    let full = cw + nw + kw;
    const th2 = 22 * u, x = r.x, y = r.y + Math.max(1, (BH * k - th2) / 2 - 3);
    const showCode = !!code && full <= r.w;
    if (!showCode && nw <= r.w) full = nw; else if (!showCode) continue;
    ctx.fillStyle = th.labelBg; ctx.fillRect(x, y, full, th2);
    ctx.strokeStyle = th.ink; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, full - 1, th2 - 1);
    let xx = x;
    if (showCode) { drawText(ctx, code, xx + 6 * u, y + 15.5 * u, cf, th.inkA(0.72)); xx += cw; ctx.beginPath(); ctx.moveTo(xx + 0.5, y); ctx.lineTo(xx + 0.5, y + th2); ctx.stroke(); }
    drawText(ctx, nm, xx + 6 * u, y + 16 * u, nf, th.inkHi, null, 0.7); xx += nw;
    if (showCode) { ctx.beginPath(); ctx.moveTo(xx + 0.5, y); ctx.lineTo(xx + 0.5, y + th2); ctx.stroke(); drawText(ctx, cnt, xx + 6 * u, y + 15.5 * u, cf, th.inkA(0.72)); }
  }
  ctx.globalAlpha = 1;
}

function drawChronology(E: Engine, ctx: CanvasRenderingContext2D, v: View, B: BldNode) {
  if (E.M.P.scale > 1) return;
  const r = rs(v, B, scratch), u = E.U, th = E.th, tx = E.tx;
  if (r.w < 560 * u) return;
  const y = r.y + r.h + 22 * u; if (y > E.SAFE.b - 26 * u) return;
  ctx.globalAlpha = labelAlpha(E) * 0.95;
  ctx.strokeStyle = th.inkA(0.55); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(r.x, y); ctx.lineTo(r.x + r.w, y); ctx.stroke();
  ctx.fillStyle = th.inkA(0.75); ctx.beginPath(); ctx.moveTo(r.x + r.w + 6, y); ctx.lineTo(r.x + r.w - 4, y - 4); ctx.lineTo(r.x + r.w - 4, y + 4); ctx.fill();
  const f = tx.f(12, 500, true);
  const t1 = 'OLDEST WORK', t2 = 'NEWEST WORK', t3 = 'LEFT TO RIGHT: WINGS IN THE ORDER WORK BEGAN, FEATURES OLDEST FIRST';
  for (const [t, px, al] of [[t1, r.x, 'left'], [t2, r.x + r.w - 10, 'right'], [t3, r.x + r.w / 2, 'center']] as const) {
    const w0 = tx.w(t, f), x0 = al === 'left' ? px : al === 'right' ? px - w0 : px - w0 / 2;
    if (al === 'center' && tx.w(t1, f) + tx.w(t2, f) + w0 + 60 * u > r.w) continue;
    ctx.fillStyle = th.paper; ctx.fillRect(x0 - 6, y - 8 * u, w0 + 12, 16 * u);
    ctx.textAlign = al; drawText(ctx, t, px, y + 4.5 * u, f, th.inkA(0.8));
  }
  ctx.textAlign = 'left'; ctx.globalAlpha = 1;
}

export function drawLabels(E: Engine, ctx: CanvasRenderingContext2D, v: View) {
  for (const B of E.M.L.blds) {
    drawBayTags(E, ctx, v, B); drawRoomLabels(E, ctx, v, B);
    const wa = drawWingLabels(E, ctx, v, B); drawBuildingLabel(E, ctx, v, B, wa); drawChronology(E, ctx, v, B);
  }
}

/** Used by hit testing and agent placement: the screen rect of a feature at the current LOD. */
export function featRect(E: Engine, v: View, fid: string, lod: number, out?: SRect): SRect | null {
  const T = E.M.L.TILE[fid]; if (!T) return null;
  const r = out ?? { x: 0, y: 0, w: 0, h: 0 };
  if (lod > 0.5) return rs(v, T, r);
  const rb = T.bay.rib, n = T.bay.tiles.length, sw = (rb.w * v.k) / n;
  r.x = sxv(v, rb.x) + T.bi * sw; r.y = syv(v, rb.y); r.w = sw; r.h = rb.h * v.k;
  return r;
}

export const TILE_W = TW;
export type { WingNode };
export { isLiveSt, lensHealth };
