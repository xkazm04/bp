// Dynamic layers, drawn every frame on top of the cached plan and culled to the viewport: hover and
// selection outlines, dependency conduits, standing-order zones, targets, the swarm (glow, trails,
// marks, chips), activity pulses, RFI pennants, breach rivets, steering previews, the focused decision
// and freed agents. Per-agent position records are reused; nothing big is allocated per frame.
import { GA_MILESTONE, astat, hash01, type SimAgent, type SimDecision } from '@bp/core/model';
import type { Engine } from '../Engine';
import { drawText } from '../text';
import { clamp } from '../camera';
import { agentColor, glyphAgent, glyphPin } from './glyphs';
import { featRect } from './plan';
import { onView, rs, sxv, syv, type SRect, type View } from './view';

// Reduced motion (E.cam.reduced, the engine's one signal): dashes hold still, expanding rings hold at mid radius.
const dashOff = (E: Engine, m: number) => (E.cam.reduced ? 0 : E.dashT * m);
const phase = (E: Engine, x: number) => (E.cam.reduced ? 0.5 : x % 1);
const ease = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

export interface Trail { qx: number; qy: number; px: number; py: number; mx: number; my: number; u: number; fade: number }
export interface APos { x: number; y: number; chip: boolean; r: SRect; idx: number; n: number; moving: boolean; trail: null | Trail; ok: boolean; /** the record `trail` points at while moving (allocated once) */ tbuf?: Trail }
const sr1: SRect = { x: 0, y: 0, w: 0, h: 0 }, sr2: SRect = { x: 0, y: 0, w: 0, h: 0 };

function posAt(E: Engine, v: View, fid: string, i: number, n: number, lod: number, out: { x: number; y: number; chip: boolean; r: SRect }): boolean {
  const T = E.M.L.TILE[fid]; if (!T) return false;
  const u = E.U, rb = T.bay.rib, nb = T.bay.tiles.length;
  let rx = sxv(v, rb.x + ((T.bi + 0.5) / nb) * rb.w), ry = syv(v, rb.y + rb.h / 2);
  if (n > 1) { const an = (i / n) * 6.2832 + 0.6; rx += Math.cos(an) * 7 * u; ry += Math.sin(an) * 5.5 * u; }
  if (lod <= 0.001) { out.x = rx; out.y = ry; out.chip = false; return true; }
  rs(v, T, out.r);
  const chips = out.r.w >= 100 * u && out.r.h >= 58 * u, step = (chips ? 62 : 15) * u;
  const tx = out.r.x + (chips ? 20 : 12) * u + i * step, ty = out.r.y + out.r.h - (chips ? 14 : 10) * u;
  out.x = rx + (tx - rx) * lod; out.y = ry + (ty - ry) * lod; out.chip = chips && lod > 0.6;
  return true;
}
const tmpQ = { x: 0, y: 0, chip: false, r: { x: 0, y: 0, w: 0, h: 0 } as SRect };

export function agentPos(E: Engine, v: View, A: SimAgent, lod: number, now: number, out: APos): APos | null {
  const list = E.M.sim.AGF[A.f] || null, i = list ? Math.max(0, list.indexOf(A)) : 0, n = list ? list.length : 1;
  if (!posAt(E, v, A.f, i, n, lod, out)) { out.ok = false; return null; }
  out.idx = i; out.n = n; out.moving = false; out.trail = null; out.ok = true;
  if (A.tr) {
    const uu = (now - A.tr.t0) / A.tr.dur;
    if (posAt(E, v, A.tr.from, 0, 1, lod, tmpQ)) {
      const mx = (tmpQ.x + out.x) / 2, my = (tmpQ.y + out.y) / 2 - Math.hypot(out.x - tmpQ.x, out.y - tmpQ.y) * 0.18 - 10 * E.U;
      const e = ease(clamp(uu, 0, 1)), px = out.x, py = out.y;
      if (uu < 1) { out.x = (1 - e) * (1 - e) * tmpQ.x + 2 * (1 - e) * e * mx + e * e * px; out.y = (1 - e) * (1 - e) * tmpQ.y + 2 * (1 - e) * e * my + e * e * py; out.chip = false; out.moving = true; }
      const T = (out.tbuf ||= { qx: 0, qy: 0, px: 0, py: 0, mx: 0, my: 0, u: 0, fade: 0 });
      T.qx = tmpQ.x; T.qy = tmpQ.y; T.px = px; T.py = py; T.mx = mx; T.my = my; T.u = Math.min(1, uu); T.fade = uu < 1 ? 1 : 1 - (now - A.tr.t0 - A.tr.dur) / 5000;
      out.trail = T;
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------- overlays
const sr3: SRect = { x: 0, y: 0, w: 0, h: 0 };
function route(E: Engine, ctx: CanvasRenderingContext2D, A: SRect, B: SRect, col: string, rev: boolean) {
  const ax = A.x + A.w / 2, ay = A.y + A.h / 2, bx = B.x + B.w / 2, by = B.y + B.h / 2;
  let ex = bx, ey = by;
  ctx.beginPath();
  if (Math.abs(bx - ax) > Math.abs(by - ay)) {
    const sx = ax + (bx > ax ? A.w / 2 : -A.w / 2); ex = bx + (bx > ax ? -B.w / 2 : B.w / 2); const mx = (sx + ex) / 2;
    ctx.moveTo(sx, ay); ctx.lineTo(mx, ay); ctx.lineTo(mx, by); ctx.lineTo(ex, by);
  } else {
    const sy = ay + (by > ay ? A.h / 2 : -A.h / 2); ey = by + (by > ay ? -B.h / 2 : B.h / 2); const my = (sy + ey) / 2;
    ctx.moveTo(ax, sy); ctx.lineTo(ax, my); ctx.lineTo(bx, my); ctx.lineTo(bx, ey);
  }
  ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.setLineDash(DASH_C); ctx.lineDashOffset = dashOff(E, rev ? 1 : -1); ctx.stroke(); ctx.setLineDash(NO_DASH);
  ctx.fillStyle = col; ctx.beginPath(); ctx.arc(rev ? ax : ex, rev ? ay : ey, 2.6, 0, 7); ctx.fill();
}
// Dash patterns, shared. setLineDash COPIES the array it is given, so a literal at a call site allocates one
// array per call - and every function in this file runs once per frame, where the rule is that a frame
// allocates nothing. check:render-units refuses a setLineDash literal anywhere under render/.
const NO_DASH: number[] = [];
const DASH_C = [6, 4];       // conduits, steering and answer previews, a standing order over one feature, the lasso
const DASH_ZONE = [9, 5];    // a standing order's domain scope
const DASH_TGT = [7, 4];     // the target set
const DASH_TRAIL = [3, 4];   // an agent's recent move, and the lines to the agents a question holds
const DASH_ARROW = [8, 5];   // the curve to an agent's next tile
const DASH_RING = [3, 3];    // the ring on an agent a preview or an answer would move or free
const DASH_GHOST = [4, 3];   // the ghost breach rivet an answer would add or clear

function conduits(E: Engine, ctx: CanvasRenderingContext2D, v: View, id: string) {
  const f = E.M.P.F[id], T = E.M.L.TILE[id]; if (!f || !T) return;
  const A = rs(v, T, sr3), th = E.th;
  ctx.globalAlpha = 0.95;
  for (const d of f.dependsOn) { const t = E.M.L.TILE[d]; if (t) route(E, ctx, A, rs(v, t, sr1), th.accent, false); }
  for (const x of f.usedBy) { const t = E.M.L.TILE[x]; if (t) route(E, ctx, A, rs(v, t, sr1), th.inkA(0.75), true); }
  ctx.globalAlpha = 1; ctx.lineDashOffset = 0;
}

/** The domains a blast radius touches (the closure never changes after load: one slot, keyed by the blast id). */
let blastRoomsOf = '', blastRoomsM: unknown = null, blastRooms: string[] = [];
function roomsOfBlast(E: Engine, id: string): string[] {
  if (blastRoomsOf !== id || blastRoomsM !== E.M) {
    const set = new Set<string>(); for (const f of E.M.closure.of(id)) set.add(E.M.P.F[f].domain);
    blastRooms = Array.from(set); blastRoomsOf = id; blastRoomsM = E.M;
  }
  return blastRooms;
}

/** Outline features that are GA-milestone (ga) or bad/watch under lens `key`. */
function outlineIf(E: Engine, ctx: CanvasRenderingContext2D, v: View, lod: number, ga: boolean, key: string | null, col: string) {
  ctx.strokeStyle = col; ctx.lineWidth = 1.6;
  for (const f of E.M.P.features) {
    if (ga) { if (f.milestone !== GA_MILESTONE) continue; } else { const h = f.lens[key!]?.h; if (h !== 'bad' && h !== 'watch') continue; }
    const r = featRect(E, v, f.id, lod, sr1); if (r && onView(v, r, 0)) ctx.strokeRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4);
  }
}
function selBox(E: Engine, ctx: CanvasRenderingContext2D, v: View, lod: number, sid: string | null) {
  if (!sid || !E.M.L.TILE[sid]) return;
  const r = featRect(E, v, sid, lod, sr1)!, pad = clamp(r.w * 0.12, 5, 14);
  ctx.strokeStyle = E.accentOf(E.S.view === 'general' ? null : E.S.view); ctx.lineWidth = 1.8; ctx.setLineDash(DASH_S); ctx.lineDashOffset = dashOff(E, -0.6);
  ctx.strokeRect(r.x - pad, r.y - pad, r.w + pad * 2, r.h + pad * 2); ctx.setLineDash(NO_DASH); ctx.lineDashOffset = 0;
}
const DASH_S = [5, 4], DASH_B = [8, 4];

export function drawOverlays(E: Engine, ctx: CanvasRenderingContext2D, v: View, lod: number) {
  const S = E.S, th = E.th, k = v.k, L = E.M.L;
  // non-tile hover tint
  if (S.hover && S.hover.type !== 'tile' && S.hover.type !== 'agent' && S.hover.type !== 'pin') {
    const o = E.placeById(S.hover.type, S.hover.id);
    if (o) { const hr = rs(v, o, sr1); ctx.fillStyle = th.alpha(th.accent, 0.08); ctx.fillRect(hr.x, hr.y, hr.w, hr.h); }
  }
  if (S.blast) {
    const rooms = roomsOfBlast(E, S.blast);
    ctx.strokeStyle = th.red; ctx.lineWidth = 1.6; ctx.setLineDash(DASH_B);
    for (let i = 0; i < rooms.length; i++) { const r = rs(v, L.ROOM[rooms[i]], sr1); ctx.strokeRect(r.x + 5, r.y + 5, r.w - 10, r.h - 10); }
    ctx.setLineDash(NO_DASH);
  }
  if (S.ga) outlineIf(E, ctx, v, lod, true, null, th.amber);
  if (S.key) outlineIf(E, ctx, v, lod, false, S.key, th.red2);
  const hid = (S.hover && S.hover.type === 'tile' ? S.hover.id : null) || S.hl || S.open || S.sel;
  if (hid && L.TILE[hid] && k > 0.1 && lod > 0.3) conduits(E, ctx, v, hid);
  selBox(E, ctx, v, lod, S.open); selBox(E, ctx, v, lod, S.sel);
  if (S.hover && (S.hover.type === 'tile' || E.placeById(S.hover.type, S.hover.id))) {
    const hr = S.hover.type === 'tile' ? featRect(E, v, S.hover.id, lod, sr1) : rs(v, E.placeById(S.hover.type, S.hover.id)!, sr1);
    if (hr) { ctx.strokeStyle = S.hover.type === 'tile' ? th.inkHi : th.accent; ctx.lineWidth = S.hover.type === 'tile' ? 2.5 : 2; ctx.strokeRect(hr.x, hr.y, hr.w, hr.h); }
  }
  if (S.hl && L.TILE[S.hl]) { const q = featRect(E, v, S.hl, lod, sr1)!; ctx.strokeStyle = th.inkHi; ctx.lineWidth = 2.5; ctx.strokeRect(q.x - 3, q.y - 3, q.w + 6, q.h + 6); }
}

// -------------------------------------------------------------------------------------- the swarm
export function drawOrderZones(E: Engine, ctx: CanvasRenderingContext2D, v: View, lod: number) {
  const sim = E.M.sim; if (!sim.has) return;
  const S = E.S, th = E.th, u = E.U, L = E.M.L;
  for (const o of sim.orders) {
    const sc = o.scope || {}, hi = S.ordHi === o.id;
    if (sc.domain) {
      for (const R of L.rooms) {
        if (!(R.d.base === sc.domain || R.d.id === sc.domain)) continue;
        const r = rs(v, R, sr1); if (!onView(v, r)) continue;
        ctx.save(); ctx.strokeStyle = hi ? th.inkHi : th.alpha(th.amber, 0.8); ctx.lineWidth = hi ? 2.5 : 1.5; ctx.setLineDash(DASH_ZONE); ctx.lineDashOffset = dashOff(E, -0.5);
        ctx.strokeRect(r.x + 5 * u, r.y + 5 * u, r.w - 10 * u, r.h - 10 * u); ctx.restore();
        if (hi) { ctx.fillStyle = th.alpha(th.amber, 0.08); ctx.fillRect(r.x, r.y, r.w, r.h); }
        if (r.w >= 230 * u && r.h >= 40 * u && (R.labelRight ?? 0) < r.x + r.w - 80 * u) {
          const sx = r.x + r.w - 62 * u, sy = r.y + 17 * u;
          ctx.save(); ctx.translate(sx, sy); ctx.rotate(-0.14); ctx.strokeStyle = th.amber; ctx.fillStyle = th.alpha(th.panel, 0.92); ctx.lineWidth = 1.6;
          ctx.beginPath(); ctx.arc(0, 0, 13 * u, 0, 6.2832); ctx.fill(); ctx.stroke();
          ctx.textAlign = 'center'; drawText(ctx, o.id, 0, 4.2 * u, E.tx.f(12, 600, true), th.amberText); ctx.restore(); ctx.textAlign = 'left';
        }
      }
    } else if (hi || (o.user && E.isNow)) {
      const ids = sim.ordMap()[o.id] || {};
      for (const id in ids) {
        const fr = featRect(E, v, id, lod, sr1); if (!fr || !onView(v, fr, 0)) continue;
        ctx.save(); ctx.strokeStyle = hi ? th.inkHi : th.alpha(th.amber, 0.8); ctx.lineWidth = hi ? 2.4 : 1.5; ctx.setLineDash(DASH_C); ctx.lineDashOffset = dashOff(E, -0.5);
        ctx.strokeRect(fr.x - 2, fr.y - 2, fr.w + 4, fr.h + 4); ctx.restore();
        if (o.user && lod > 0.5 && fr.w >= 60 * u) {
          ctx.fillStyle = th.alpha(th.panel, 0.92); ctx.strokeStyle = th.amber; ctx.lineWidth = 1.3;
          ctx.fillRect(fr.x + 4 * u, fr.y + fr.h - 22 * u, 36 * u, 17 * u); ctx.strokeRect(fr.x + 4.5 * u, fr.y + fr.h - 21.5 * u, 36 * u - 1, 17 * u - 1);
          drawText(ctx, o.id, fr.x + 9 * u, fr.y + fr.h - 9 * u, E.tx.f(12, 600, true), th.amberText);
        }
      }
    }
  }
}

export function drawTargets(E: Engine, ctx: CanvasRenderingContext2D, v: View, lod: number) {
  const S = E.S; if (!S.tgt.n) return;
  const th = E.th, u = E.U;
  ctx.save(); ctx.strokeStyle = th.accent; ctx.lineWidth = 2; ctx.setLineDash(DASH_TGT); ctx.lineDashOffset = dashOff(E, -1);
  for (const R of E.M.L.rooms) {
    let c = 0; for (const f of R.feats) if (S.tgt.ids[f.id]) c++;
    if (!c) continue;
    const r = rs(v, R, sr1); if (!onView(v, r, 10)) continue;
    if (c === R.feats.length) { ctx.fillStyle = th.alpha(th.accent, 0.09); ctx.fillRect(r.x, r.y, r.w, r.h); ctx.strokeRect(r.x + 4 * u, r.y + 4 * u, r.w - 8 * u, r.h - 8 * u); }
    else for (const f of R.feats) {
      if (!S.tgt.ids[f.id]) continue;
      const fr = featRect(E, v, f.id, lod, sr2); if (!fr) continue;
      ctx.fillStyle = th.alpha(th.accent, 0.14); ctx.fillRect(fr.x, fr.y, fr.w, fr.h); ctx.strokeRect(fr.x - 2, fr.y - 2, fr.w + 4, fr.h + 4);
    }
  }
  ctx.restore();
}

/** Working tiles glow faintly from below (the "heat" of recent activity). */
export function drawHeat(E: Engine, ctx: CanvasRenderingContext2D, v: View, lod: number, now: number) {
  const sim = E.M.sim; if (!sim.has || !E.isNow || lod < 0.3) return;
  const glow = E.sprites.heat; if (!glow) return;
  ctx.globalAlpha = 1;
  for (const fid in sim.AGF) {
    const ag = sim.AGF[fid]; let working = false;
    for (const a of ag) if (a.status === 'working' && !a.paused) { working = true; break; }
    const hv = sim.heatNow(fid, now);
    if (!working && hv <= 0.15) continue;
    const r = featRect(E, v, fid, lod, sr1); if (!r || !onView(v, r, 0)) continue;
    const hh = clamp(0.35 + hv * 0.25, 0.2, 1);
    ctx.globalAlpha = hh * lod;
    ctx.drawImage(glow, r.x, r.y + r.h * 0.15, r.w, r.h * 0.85);
  }
  ctx.globalAlpha = 1;
}

/**
 * How bright an agent draws. A crew picked in the Agents flyout (`S.crew`) lights up: its agents stay at full
 * alpha (and get a ring), every other agent dims. With no crew picked, crews that do not serve the viewed lens dim.
 */
export function agentAlpha(sq: string, crew: string | null, rel: boolean): number {
  if (crew) return sq === crew ? 1 : 0.22;
  return rel ? 1 : 0.42;
}

export function drawAgents(E: Engine, ctx: CanvasRenderingContext2D, v: View, lod: number, now: number) {
  const sim = E.M.sim; if (!sim.has || !E.isNow) return;
  const th = E.th, u = E.U, S = E.S, pos = E.agentPos;
  let count = 0;
  for (let i = 0; i < sim.agents.length; i++) {
    const A = sim.agents[i], p = pos[i] || (pos[i] = { x: 0, y: 0, chip: false, r: { x: 0, y: 0, w: 0, h: 0 }, idx: 0, n: 1, moving: false, trail: null, ok: false });
    if (!agentPos(E, v, A, lod, now, p)) continue;
    if (p.x < -40 || p.x > v.FW + 40 || p.y < -40 || p.y > v.FH + 40) { p.ok = false; continue; }
    if (A.status === 'working' && !A.paused && !p.moving && lod < 0.8 && sim.playing && !E.cam.reduced) {
      const orb = 3.2 * u * (1 - lod); p.x += Math.cos(now * 0.0011 + A.ph) * orb; p.y += Math.sin(now * 0.0013 + A.ph) * orb * 0.7;
    }
    count++;
  }
  if (!count) return;
  // glow (one sprite, additive)
  const glow = E.sprites.glow;
  if (glow) {
    ctx.save(); ctx.globalCompositeOperation = th.mode === 'dark' ? 'lighter' : 'source-over';
    for (let i = 0; i < sim.agents.length; i++) {
      const p = pos[i], A = sim.agents[i]; if (!p || !p.ok || astat(A) !== 'working') continue;
      const ga = agentAlpha(A.sq, S.crew, sim.crewRelevant(A, S.view)), rad = (15 + lod * 10) * u * (ga === 1 ? 1 : 0.6);
      ctx.globalAlpha = ga === 1 ? 1 : ga * 0.95;
      ctx.drawImage(glow, p.x - rad, p.y - rad, rad * 2, rad * 2);
    }
    ctx.restore();
  }
  // trails of recent moves
  for (let i = 0; i < sim.agents.length; i++) {
    const p = pos[i]; if (!p || !p.ok || !p.trail || p.trail.fade <= 0) continue;
    const t = p.trail;
    ctx.save(); ctx.globalAlpha = clamp(t.fade, 0, 1) * 0.85; ctx.strokeStyle = th.mint; ctx.lineWidth = 1.6; ctx.setLineDash(DASH_TRAIL); ctx.lineDashOffset = dashOff(E, -1);
    ctx.beginPath();
    for (let s = 0; s <= 16; s++) { const e = ease((t.u * s) / 16), x = (1 - e) * (1 - e) * t.qx + 2 * (1 - e) * e * t.mx + e * e * t.px, y = (1 - e) * (1 - e) * t.qy + 2 * (1 - e) * e * t.my + e * e * t.py; if (s) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
    ctx.stroke(); ctx.restore();
  }
  // marks and chips
  const chipFont = E.tx.f(12, 500, true);
  for (let i = 0; i < sim.agents.length; i++) {
    const p = pos[i], A = sim.agents[i]; if (!p || !p.ok) continue;
    const st = astat(A), al = agentAlpha(A.sq, S.crew, sim.crewRelevant(A, S.view)), rel = al === 1;
    if (S.crew && A.sq === S.crew) { ctx.strokeStyle = th.accent; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(p.x, p.y, (p.chip && !p.moving ? 15 : 9) * u, 0, 6.2832); ctx.stroke(); }
    if (A.flash && now - A.flash < 1100) {
      const fu = (now - A.flash) / 1100; ctx.save(); ctx.strokeStyle = th.inkHi; ctx.globalAlpha = (1 - fu) * 0.9; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, (6 + fu * 22) * u, 0, 6.2832); ctx.stroke(); ctx.restore();
    }
    if (p.chip && !p.moving) {
      const nd = (sim.DOF[A.f] || []).length;
      const cap = Math.max(1, Math.floor((p.r.w - 14 * u - nd * 18 * u) / (62 * u)));
      if (p.n > cap && p.idx >= cap - 1) {
        if (p.idx === cap - 1) {
          const x0 = p.x - 13 * u, y0 = p.y - 10 * u;
          ctx.fillStyle = th.chipBg; ctx.fillRect(x0, y0, 58 * u, 20 * u); ctx.strokeStyle = th.inkA(0.6); ctx.lineWidth = 1.3; ctx.strokeRect(x0 + 0.5, y0 + 0.5, 58 * u - 1, 20 * u - 1);
          drawText(ctx, '+' + (p.n - cap + 1), x0 + 8 * u, y0 + 14.4 * u, chipFont, th.inkHi);
        }
        continue;
      }
      const w = 58 * u, h = 20 * u, x0 = p.x - 13 * u, y0 = p.y - h / 2;
      ctx.globalAlpha = al;
      ctx.fillStyle = th.chipBg; ctx.fillRect(x0, y0, w, h);
      ctx.strokeStyle = agentColor(th, st); ctx.lineWidth = 1.3; ctx.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1);
      glyphAgent(ctx, th, p.x, p.y, st, 4 * u, 1, E.cam.reduced ? A.ph : now / 900 + A.ph, u);
      drawText(ctx, A.code, p.x + 9 * u, p.y + 4.2 * u, chipFont, th.inkHi);
      ctx.globalAlpha = 1;
    } else {
      const s = (p.chip ? 4.6 : 4.4) * u * (rel ? 1 : 0.8) * (p.moving ? 1.15 : 1);
      glyphAgent(ctx, th, p.x, p.y, st, s, al, sim.playing && !E.cam.reduced ? now / 900 + A.ph : A.ph, u);
    }
  }
}

function pulseCol(th: Engine['th'], k: string): string {
  switch (k) { case 'bad': return th.red; case 'pr': return th.accent; case 'dep': return th.inkHi; case 'flag': case 'warn': case 'ask': return th.amber; default: return th.mint; }
}
export function drawPulses(E: Engine, ctx: CanvasRenderingContext2D, v: View, lod: number, now: number) {
  const sim = E.M.sim; if (!sim.has || !E.isNow || !sim.pulses.length) return;
  const u = E.U, th = E.th;
  ctx.save(); ctx.lineWidth = 2;
  for (const p of sim.pulses) {
    const age = (now - p.t0) / (p.k === 'dep' || p.k === 'ask' ? 2200 : 1500);
    if (age >= 1 || age < 0) continue;
    const r = featRect(E, v, p.f, lod, sr1); if (!r || !onView(v, r, 40)) continue;
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2, rad = (5 + (E.cam.reduced ? 0.5 : age) * (p.k === 'dep' ? 46 : 28)) * u;
    ctx.strokeStyle = pulseCol(th, p.k); ctx.globalAlpha = (1 - age) * 0.85;
    ctx.beginPath(); ctx.arc(cx, cy, rad, 0, 6.2832); ctx.stroke();
    if (p.k === 'dep' || p.k === 'bad') { ctx.beginPath(); ctx.arc(cx, cy, rad * 0.6, 0, 6.2832); ctx.stroke(); }
  }
  ctx.restore();
}

const pinXY = { x: 0, y: 0 };
/** Where a room's question pin stands (screen px). One shared record: read it at once. */
export function roomPinPos(E: Engine, v: View, ri: number): { x: number; y: number } {
  const r = rs(v, E.M.L.rooms[ri], sr2), u = E.U;
  pinXY.x = r.x + r.w - 18 * u; pinXY.y = r.y + 32 * u;
  return pinXY;
}

export function drawPins(E: Engine, ctx: CanvasRenderingContext2D, v: View, lod: number, now: number) {
  const sim = E.M.sim; if (!sim.has || !E.isNow) return;
  const u = E.U, th = E.th, S = E.S, pf = E.tx.f(12, 600, true);
  if (lod < 0.995) {
    ctx.save(); const ga = 1 - lod;
    const byRoom = E.roomDecs();
    for (let ri = 0; ri < byRoom.length; ri++) {
      const ds = byRoom[ri]; if (!ds.length) continue;
      const R = E.M.L.rooms[ri], r = rs(v, R, sr1); if (!onView(v, r, 30)) continue;
      let em = 0, hi = false, anyNew = false;
      for (const d of ds) { const e = sim.emph(d, S.who, S.view); if (e) { em++; if (d.urg === 'high') hi = true; } if (d.isNew) anyNew = true; }
      const ring = anyNew ? phase(E, now / 1600) : 0;
      ctx.globalAlpha = ga;
      const pp = roomPinPos(E, v, ri);
      glyphPin(ctx, th, pp.x, pp.y, hi ? 'high' : em ? 'med' : 'low', em > 0, 0.9, ds.length, ring, u, pf);
    }
    ctx.restore();
  }
  if (lod > 0.005) {
    ctx.save(); ctx.globalAlpha = lod;
    for (const fid in sim.DOF) {
      const ds = sim.DOF[fid]; if (!ds.length) continue;
      const T = E.M.L.TILE[fid]; if (!T) continue;
      const r = rs(v, T, sr1); if (!onView(v, r, 20)) continue;
      for (let j = 0; j < ds.length; j++) {
        const d = ds[j], ring = d.isNew ? phase(E, now / 1600) : S.dec === d.id ? phase(E, now / 1200) : 0;
        glyphPin(ctx, th, r.x + r.w - 12 * u - j * 18 * u, r.y + r.h - 5 * u, d.urg, sim.emph(d, S.who, S.view), 0.85, 0, ring, u, pf);
      }
    }
    ctx.restore();
  }
}

export function drawBreaches(E: Engine, ctx: CanvasRenderingContext2D, v: View, lod: number, now: number) {
  const sim = E.M.sim; if (!sim.has || !E.isNow) return;
  const u = E.U, th = E.th, seen = E.breachSet();
  for (const fid of seen) {
    const r = featRect(E, v, fid, lod, sr1); if (!r || !onView(v, r, 20)) continue;
    const big = lod > 0.5 && r.w >= 40 * u, rr = (big ? 7.5 : 4) * u, cx = big ? r.x : r.x + r.w / 2, cy = big ? r.y : r.y - 7 * u;
    const pu = sim.playing && !E.cam.reduced ? (now / 1500 + hash01(fid)) % 1 : 0.4;
    ctx.save(); ctx.strokeStyle = th.red; ctx.globalAlpha = (1 - pu) * 0.7; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(cx, cy, rr + pu * 8 * u, 0, 6.2832); ctx.stroke();
    ctx.globalAlpha = 1; ctx.fillStyle = th.red; ctx.strokeStyle = th.glyphEdge; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(cx, cy, rr, 0, 6.2832); ctx.fill(); ctx.stroke();
    if (big) { ctx.textAlign = 'center'; drawText(ctx, '!', cx, cy + 4.4 * u, E.tx.f(12, 600, true), th.glyphEdge); ctx.textAlign = 'left'; }
    ctx.restore();
  }
}

function curveArrow(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, col: string, lw: number, u: number) {
  const mx = (x0 + x1) / 2, my = (y0 + y1) / 2 - Math.hypot(x1 - x0, y1 - y0) * 0.16 - 8 * u;
  ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(mx, my, x1, y1); ctx.stroke();
  const an = Math.atan2(y1 - my, x1 - mx), hs = 8 * u;
  ctx.setLineDash(NO_DASH); ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x1, y1);
  ctx.lineTo(x1 - Math.cos(an - 0.45) * hs, y1 - Math.sin(an - 0.45) * hs); ctx.lineTo(x1 - Math.cos(an + 0.45) * hs, y1 - Math.sin(an + 0.45) * hs); ctx.closePath(); ctx.fill();
}
const ap: APos = { x: 0, y: 0, chip: false, r: { x: 0, y: 0, w: 0, h: 0 }, idx: 0, n: 1, moving: false, trail: null, ok: false };

export function drawPreview(E: Engine, ctx: CanvasRenderingContext2D, v: View, lod: number, now: number) {
  const p = E.S.prev; if (!p) return;
  const u = E.U, th = E.th, col = p.kind === 'pause' ? th.amber : th.mint;
  ctx.save();
  for (const id in p.targets) {
    const fr = featRect(E, v, id, lod, sr1); if (!fr || !onView(v, fr, 0)) continue;
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.setLineDash(DASH_C); ctx.lineDashOffset = dashOff(E, -1);
    ctx.fillStyle = th.alpha(col, p.kind === 'pause' ? 0.08 : 0.12); ctx.fillRect(fr.x, fr.y, fr.w, fr.h); ctx.strokeRect(fr.x - 2, fr.y - 2, fr.w + 4, fr.h + 4);
  }
  for (const m of p.moves) {
    const q = agentPos(E, v, m.a, lod, now, ap), tr = featRect(E, v, m.to, lod, sr2); if (!q || !tr) continue;
    const qx = q.x, qy = q.y;
    ctx.setLineDash(DASH_ARROW); ctx.lineDashOffset = dashOff(E, -1.4);
    curveArrow(ctx, qx, qy, tr.x + tr.w / 2, tr.y + tr.h / 2, th.alpha(th.mint, 0.95), 2, u);
    ctx.setLineDash(DASH_RING); ctx.strokeStyle = th.mint; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(qx, qy, 11 * u, 0, 6.2832); ctx.stroke();
  }
  for (const a of p.paused) { const q = agentPos(E, v, a, lod, now, ap); if (!q) continue; ctx.setLineDash(DASH_RING); ctx.strokeStyle = col; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.arc(q.x, q.y, 11 * u, 0, 6.2832); ctx.stroke(); }
  ctx.restore();
}

/**
 * An answer option under the pointer or focus (S.hlOpt): what choosing it would move, from the engine's memoised dry run
 * (sim.previewAnswer, the plan decide applies). Touched tiles, agents freed and moved, and one label per change at its
 * tile (rollout, coverage, follow-up question, an order breached or cleared with its owner; live: the expected move).
 */
export function drawAnswer(E: Engine, ctx: CanvasRenderingContext2D, v: View, lod: number, now: number) {
  const p = E.answerPreview(); if (!p || !p.marks || !E.isNow) return;
  const u = E.U, th = E.th, font = E.tx.f(12, 600, true), bad = th.mode === 'dark' ? th.red2 : th.red;
  ctx.save();
  for (const id in p.targets) {
    const fr = featRect(E, v, id, lod, sr1); if (!fr || !onView(v, fr, 0)) continue;
    ctx.strokeStyle = th.accent; ctx.lineWidth = 2; ctx.setLineDash(DASH_C); ctx.lineDashOffset = dashOff(E, -1); ctx.strokeRect(fr.x - 3, fr.y - 3, fr.w + 6, fr.h + 6);
  }
  for (const m of p.moves) {
    const q = agentPos(E, v, m.a, lod, now, ap), tr = featRect(E, v, m.to, lod, sr2); if (!q || !tr) continue;
    const qx = q.x, qy = q.y;
    ctx.setLineDash(DASH_ARROW); ctx.lineDashOffset = dashOff(E, -1.4);
    curveArrow(ctx, qx, qy, tr.x + tr.w / 2, tr.y + tr.h / 2, th.alpha(th.mint, 0.95), 2, u);
    ctx.setLineDash(DASH_RING); ctx.strokeStyle = th.mint; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(qx, qy, 11 * u, 0, 6.2832); ctx.stroke();
  }
  if (p.freed) for (const a of p.freed) { const q = agentPos(E, v, a, lod, now, ap); if (!q) continue; ctx.setLineDash(DASH_RING); ctx.strokeStyle = th.mint; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.arc(q.x, q.y, 11 * u, 0, 6.2832); ctx.stroke(); }
  ctx.setLineDash(NO_DASH); ctx.textAlign = 'center';
  for (const m of p.marks) {
    const fr = featRect(E, v, m.f, lod, sr1); if (!fr || !onView(v, fr, 40)) continue;
    const col = m.tone === 'bad' ? bad : m.tone === 'ok' ? th.mintText : th.inkHi;
    if (m.ring) {   // a ghost breach rivet where drawBreaches puts the real one: dashed red = would breach, mint = would clear
      const big = lod > 0.5 && fr.w >= 40 * u, cx = big ? fr.x : fr.x + fr.w / 2, cy = big ? fr.y : fr.y - 7 * u;
      ctx.strokeStyle = m.ring === 'add' ? th.red : th.mint; ctx.lineWidth = 2; ctx.setLineDash(DASH_GHOST); ctx.lineDashOffset = dashOff(E, -1);
      ctx.beginPath(); ctx.arc(cx, cy, (big ? 12 : 8) * u, 0, 6.2832); ctx.stroke(); ctx.setLineDash(NO_DASH);
    }
    drawText(ctx, m.text, fr.x + fr.w / 2, fr.y - (9 + m.row * 17) * u, font, col, th.halo);
  }
  ctx.textAlign = 'left';
  ctx.restore();
}

export function drawFocus(E: Engine, ctx: CanvasRenderingContext2D, v: View, lod: number, now: number) {
  const sim = E.M.sim, S = E.S;
  const d: SimDecision | null = S.dec ? sim.DEC[S.dec] : S.hlDec ? sim.DEC[S.hlDec] : null;
  if (!d || !d.open) return;
  const u = E.U, th = E.th, fr = featRect(E, v, d.f, lod, sr1); if (!fr) return;
  const cx = fr.x + fr.w / 2, cy = fr.y + fr.h / 2;
  ctx.save();
  for (const id of d.affects) { const a = featRect(E, v, id, lod, sr2); if (!a) continue; ctx.strokeStyle = th.amber; ctx.lineWidth = 2; ctx.setLineDash(DASH_S); ctx.lineDashOffset = dashOff(E, -1); ctx.strokeRect(a.x - 2, a.y - 2, a.w + 4, a.h + 4); }
  ctx.setLineDash(NO_DASH);
  for (const A of sim.agents) {
    if (A.wait !== d.id) continue;
    const q = agentPos(E, v, A, lod, now, ap); if (!q) continue;
    ctx.strokeStyle = th.alpha(th.amber, 0.9); ctx.lineWidth = 1.6; ctx.setLineDash(DASH_TRAIL); ctx.lineDashOffset = dashOff(E, -1);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(q.x, q.y); ctx.stroke(); ctx.setLineDash(NO_DASH); ctx.beginPath(); ctx.arc(q.x, q.y, 10 * u, 0, 6.2832); ctx.stroke();
  }
  const pu = phase(E, now / 1100); ctx.strokeStyle = th.amber; ctx.globalAlpha = 1 - pu; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(cx, cy, (12 + pu * 26) * u, 0, 6.2832); ctx.stroke();
  ctx.restore();
}

/**
 * Blocker chains, for one item at a time: the hovered blocked agent (its feature -> the feature that blocks it), or
 * the focused question when its feature blocks agents (each blocked agent's feature -> it). A dashed conduit per
 * chain and a "holds N" badge on the blocker. Nothing is drawn for agents nobody points at.
 */
export function drawBlockers(E: Engine, ctx: CanvasRenderingContext2D, v: View, lod: number) {
  const sim = E.M.sim, S = E.S; if (!sim.has || !E.isNow) return;
  let blocker: string | null = null, only: SimAgent | null = null;
  if (S.hover && S.hover.type === 'agent') { const A = sim.AG[S.hover.id]; if (A && A.blk && A.status === 'blocked' && E.M.P.F[A.blk]) { blocker = A.blk; only = A; } }
  if (!blocker) { const d = S.dec ? sim.DEC[S.dec] : S.hlDec ? sim.DEC[S.hlDec] : null; if (d && d.open && sim.blockedByFeature(d.f).length) blocker = d.f; }
  if (!blocker) return;
  const held = sim.blockedByFeature(blocker), B = featRect(E, v, blocker, lod, sr3); if (!B) return;
  const th = E.th, u = E.U;
  ctx.save(); ctx.globalAlpha = 0.95;
  for (let i = 0; i < held.length; i++) {
    const A = held[i]; if (only && A !== only) continue;
    if (A.f === blocker) continue;
    const r = featRect(E, v, A.f, lod, sr4); if (r) route(E, ctx, r, B, th.red, false);
  }
  ctx.globalAlpha = 1; ctx.lineDashOffset = 0;
  const n = held.length, label = 'holds ' + n, w = (label.length * 7.4 + 14) * u, h = 20 * u, x0 = B.x + B.w / 2 - w / 2, y0 = B.y - h - 6 * u;
  ctx.fillStyle = th.alpha(th.panel, 0.94); ctx.fillRect(x0, y0, w, h);
  ctx.strokeStyle = th.red; ctx.lineWidth = 1.4; ctx.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1);
  ctx.textAlign = 'center'; drawText(ctx, label, x0 + w / 2, y0 + 14.2 * u, E.tx.f(12, 600, true), th.inkHi); ctx.textAlign = 'left';
  ctx.restore();
}
const sr4: SRect = { x: 0, y: 0, w: 0, h: 0 };

export function drawReleases(E: Engine, ctx: CanvasRenderingContext2D, v: View, lod: number, now: number) {
  const sim = E.M.sim; if (!sim.has || !E.isNow) return;
  const u = E.U, th = E.th;
  for (const d of sim.decisions) {
    if (!d.ans || !d.freedIds.length) continue;
    const age = (now - d.ans.at) / 3200; if (age >= 1) continue;
    const fr = featRect(E, v, d.f, lod, sr1); if (!fr) continue;
    const cx = fr.x + fr.w / 2, cy = fr.y + fr.h / 2;
    ctx.save(); ctx.globalAlpha = 1 - age; ctx.strokeStyle = th.mint; ctx.fillStyle = th.mint; ctx.lineWidth = 2; ctx.setLineDash(DASH_S); ctx.lineDashOffset = dashOff(E, -1.6);
    for (const id of d.freedIds) {
      const A = sim.AG[id]; if (!A) continue;
      const q = agentPos(E, v, A, lod, now, ap); if (!q) continue;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(q.x, q.y); ctx.stroke(); ctx.setLineDash(NO_DASH); ctx.beginPath(); ctx.arc(q.x, q.y, (9 + (E.cam.reduced ? 0.5 : age) * 14) * u, 0, 6.2832); ctx.stroke(); ctx.setLineDash(DASH_S);
    }
    ctx.setLineDash(NO_DASH); ctx.textAlign = 'center'; drawText(ctx, '+' + d.freedIds.length + ' back to work', cx, cy - (18 + age * 22) * u, E.tx.f(13, 600, true), th.mintText, th.halo); ctx.textAlign = 'left';
    ctx.restore();
  }
}

export function drawLasso(E: Engine, ctx: CanvasRenderingContext2D) {
  const l = E.lasso; if (!l) return;
  const x = Math.min(l.x0, l.x1), y = Math.min(l.y0, l.y1), w = Math.abs(l.x1 - l.x0), h = Math.abs(l.y1 - l.y0), th = E.th;
  ctx.save(); ctx.fillStyle = th.alpha(th.accent, 0.1); ctx.fillRect(x, y, w, h); ctx.strokeStyle = th.accent; ctx.lineWidth = 1.6; ctx.setLineDash(DASH_C); ctx.lineDashOffset = dashOff(E, -1); ctx.strokeRect(x + 0.5, y + 0.5, w, h); ctx.restore();
}
