// Trouble flags: the plan's first signal, and what managing the blueprint is mostly about (find a flag,
// resolve it). Every lens that is bad or on watch for a feature raises a flag over it. The flags are
// drawn at the live camera, on top of every other layer, at an ON-SCREEN size that does not shrink with
// the zoom: 32 px at UI scale 1 on the site plan, growing over large tiles up to 44 px; a watch flag is
// 0.8 of a bad one. Flags that would collide merge into one cluster flag (the worst lens's glyph and a
// count), the way map markers do, so the site plan shows a few large flags rather than a hundred
// specks, and zooming in splits them back into one flag per feature and lens.
//
// Where a flag stands says which lens it is: over a tile, flags stand in registry order across its top
// edge (the order of General's strip); on a ribbon segment (site and wing plans), over its middle.
// A lens fades its flags with its presence in the mix, so a lens view keeps only its own.
//
// A click on a flag opens its feature in its lens; on a cluster of one feature, in its worst lens; on a
// cluster of several, flies to them so they split. The engine hit-tests the flags of the last frame.
import type { Feature } from '@bp/core/data';
import type { RoomNode, WingNode } from '@bp/core/model';
import type { Engine } from '../Engine';
import { RH } from '@bp/core/model';
import { clamp } from '../camera';
import { drawText } from '../text';
import { glyph } from './lens-glyph';
import { featRect, roomLabelFit } from './plan';
import { sxv, syv, type SRect, type View } from './view';


let ON: boolean | null = null;
/** Flags are on unless the page asks ?flags=0 (to compare against the plan without them). */
export function flagsOn(): boolean {
  if (ON === null) ON = typeof window === 'undefined' || new URLSearchParams(window.location.search).get('flags') !== '0';
  return ON;
}

export interface Flag {
  /** The flag body (screen px); the pointer runs from its foot to the tip. */
  x: number; y: number; w: number; h: number; tipX: number; tipY: number;
  bad: boolean; lens: string; fid: string;
  /** Every feature and lens merged into this flag (one entry each for a single flag). */
  fids: string[]; lenses: string[];
  /** Presence 0..1 (the lens's weight in the mix). */
  a: number;
}

// features with any trouble, per product (the list never changes after load)
const TROUBLED = new WeakMap<readonly Feature[], Feature[]>();
function troubled(fs: readonly Feature[]): Feature[] {
  let t = TROUBLED.get(fs);
  if (!t) { t = fs.filter((f) => f.trouble.length > 0); TROUBLED.set(fs, t); }
  return t;
}

/** Bad flag size over a feature rect: the floor everywhere, larger over a big tile. */
function sizeOf(E: Engine, r: SRect, tile: boolean): number {
  const u = E.U;
  return tile ? clamp(r.w * 0.12, 32 * u, 44 * u) : 32 * u;
}
const tipOf = (s: number) => s * 0.26;
const sr: SRect = { x: 0, y: 0, w: 0, h: 0 };

// Title boxes a flag must not cover. A room label in its header is `labelBox` (set by the renderer); a label
// pinned to the top of the view and the wing title above the wing are recomputed here from the layout and the
// live camera (the same rules plan.ts draws them by), so they hold between rasters and cost no allocation.
const UP = new Map<string, string>();
const upper = (s: string) => { let t = UP.get(s); if (t === undefined) { t = s.toUpperCase(); UP.set(s, t); } return t; };
/** Step the body (x, width w, top y, height s) clear of a box, to whichever side is nearer. */
function clear(x: number, y: number, w: number, s: number, bx: number, by: number, bw: number, bh: number, u: number): number {
  if (!(x < bx + bw && x + w > bx && y < by + bh && y + s > by)) return x;
  const r = bx + bw + 3 * u, l = bx - w - 3 * u;
  return r - x <= x - l ? r : l;
}
/** The room's label pinned to the top of the view (not in its header): where plan.ts draws it, or null. */
export function pinnedBox(E: Engine, v: View, R: RoomNode, out: SRect): SRect | null {
  const u = E.U, k = v.k, hh = RH * k, ry = syv(v, R.y), rh = R.h * k;
  const maxW = R.w * k - 28 * u - (E.M.sim.has ? 38 * u : 0);
  if (maxW <= 0) return null;
  // the same sizing passes plan.ts draws the label by (its 14 px fallback and its fade-out included)
  const { fs, ls, lines } = roomLabelFit(E.tx, upper(R.d.name), maxW, hh, u);
  if (!lines) return null;
  const blockH = lines.length * fs * 1.08 * u;
  if (hh < blockH + 14 * u) return null;
  const y = Math.max(ry + 8 * u, Math.min(Math.max(v.c0y, E.SAFE.t) + 8 * u, ry + rh - blockH - 30 * u));
  if (y <= ry + 8 * u) return null;
  const font = E.tx.f(fs, 600);
  let pw = 0; for (const l of lines) pw = Math.max(pw, E.tx.w(l, font, ls));
  out.x = sxv(v, R.x) + 8 * u; out.y = y - 3 * u; out.w = pw + 12 * u; out.h = blockH + 8 * u;
  return out;
}
/** The wing's title stack above it (bubble, name; up to two lines), generously: null while the renderer draws none. */
function wingBox(E: Engine, v: View, W: WingNode, out: SRect): SRect | null {
  const u = E.U, k = v.k, ww = W.w * k;
  if (ww < 80 * u || (E.M.P.scale > 1 && k <= E.KB1 * 0.62)) return null;
  const base = syv(v, W.y) - 10 * u, tw = 28 * u + E.tx.w(upper(W.def.name), E.tx.f(18, 600), 1);
  out.x = sxv(v, W.x) + 6 * u; out.w = Math.min(tw, ww - 14 * u); out.y = base - 108 * u; out.h = 74 * u;
  return out;
}
const tb: SRect = { x: 0, y: 0, w: 0, h: 0 };

// Layout pools: flags are reused frame to frame (a plain pan allocates nothing). The returned array and its
// Flag records are valid until the next layoutFlags call.
const POOL: Flag[] = [], CANDS: Flag[] = [], OUT: Flag[] = [];
let nPool = 0;
function take(): Flag {
  if (nPool === POOL.length) POOL.push({ x: 0, y: 0, w: 0, h: 0, tipX: 0, tipY: 0, bad: false, lens: '', fid: '', fids: [], lenses: [], a: 0 });
  return POOL[nPool++];
}
// bad before watch, then the more present lens, then left to right: the first flag placed in a spot keeps it
const byPlace = (p: Flag, q: Flag) => Number(q.bad) - Number(p.bad) || q.a - p.a || p.tipX - q.tipX;

/** Lay out this frame's flags (clustered), in draw order reversed: index 0 is drawn last, on top. */
export function layoutFlags(E: Engine, v: View, lod: number): Flag[] {
  const out = OUT; out.length = 0;
  if (!flagsOn() || !E.isNow) return out;
  const u = E.U, m = E.mixS, ids = E.lensIds, n = ids.length, tile = lod > 0.5;
  // merge distance: generous on the site and wing plans (a few markers per room), tight over tiles
  const gap = (tile ? 4 : 4 + 22 * (1 - lod / 0.5)) * u;
  const cands = CANDS; cands.length = 0; nPool = 0;
  for (const f of troubled(E.M.P.features)) {
    if (E.dimFn && !E.dimFn(f)) continue;
    const r = featRect(E, v, f.id, lod, sr); if (!r) continue;
    if (r.x > v.FW + 60 || r.x + r.w < -60 || r.y > v.FH + 80 || r.y < -80) continue;
    const S = sizeOf(E, r, tile);
    for (const t of f.trouble) {
      const a = m.p[t.lens] ?? 0; if (a < 0.04) continue;
      const li = ids.indexOf(t.lens); if (li < 0) continue;
      const s = t.h === 'bad' ? S : S * 0.8, w = s * 1.1, tip = tipOf(s);
      const tipX = tile ? r.x + r.w * ((li + 0.5) / n) : r.x + r.w / 2, tipY = r.y + (tile ? 2 * u : 0);
      let x = tipX - w / 2;
      // step right of a room label the body would cover (the label names the place the flag is in)
      const tl = E.M.L.TILE[f.id], lb = tl?.room.labelBox;
      if (lb) {
        const lx = sxv(v, lb.x), ly = syv(v, lb.y), lw = lb.w * v.k, lh = lb.h * v.k, y = tipY - tip - s;
        if (x < lx + lw && x + w > lx && y < ly + lh && y + s > ly) x = Math.max(x, lx + lw + 3 * u);
      } else if (tl) {
        const pb = pinnedBox(E, v, tl.room, tb);
        if (pb) x = clear(x, tipY - tip - s, w, s, pb.x, pb.y, pb.w, pb.h, u);
      }
      if (tl) { const wb = wingBox(E, v, tl.wing, tb); if (wb) x = clear(x, tipY - tip - s, w, s, wb.x, wb.y, wb.w, wb.h, u); }
      const c = take();
      c.x = x; c.y = tipY - tip - s; c.w = w; c.h = s; c.tipX = tipX; c.tipY = tipY; c.bad = t.h === 'bad'; c.lens = t.lens; c.fid = f.id; c.a = a;
      c.fids.length = 0; c.fids.push(f.id); c.lenses.length = 0; c.lenses.push(t.lens);
      cands.push(c);
    }
  }
  cands.sort(byPlace);
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i];
    let hit: Flag | null = null;
    for (let j = 0; j < out.length; j++) {
      const o = out[j];
      if (c.x < o.x + o.w + gap && c.x + c.w + gap > o.x && c.y < o.y + o.h + tipOf(o.h) + gap && c.y + c.h + tipOf(c.h) + gap > o.y) { hit = o; break; }
    }
    if (hit) { hit.fids.push(c.fid); hit.lenses.push(c.lens); hit.a = Math.max(hit.a, c.a); }
    else out.push(c);
  }
  return out;
}

/** A flag's identity across frames (its first feature and lens): what hover remembers. */
export const flagKey = (F: Flag) => F.fid + '|' + F.lens;

const COUNTS: string[] = [];

/** Draw the flags of this frame; `hot` is the hovered one's key (drawn a little larger). */
export function drawFlags(E: Engine, ctx: CanvasRenderingContext2D, flags: readonly Flag[], hot: string | null) {
  if (!flags.length) return;
  const th = E.th, u = E.U, nf = E.tx.f(12, 700, true);
  ctx.save();
  for (let i = flags.length - 1; i >= 0; i--) {
    const F = flags[i], k = hot && flagKey(F) === hot ? 1.12 : 1;
    const s = F.h * k, w = F.w * k, tip = tipOf(s), x = F.x + (F.w - w) / 2, y = F.tipY - tip - s;
    const col = F.bad ? th.red : th.amber, r = Math.min(5 * u, s * 0.2), pw = Math.min(6 * u, w * 0.2);
    // the pointer's base stays under the body when the body stepped aside from a label
    const bx = clamp(F.tipX, x + r + pw, x + w - r - pw);
    ctx.globalAlpha = F.a;
    const lead = Math.abs(bx - F.tipX) > pw * 1.5;
    if (lead) {
      // stepped far aside: a leader line to a dot on the feature, like a callout on a drawing
      ctx.beginPath(); ctx.moveTo(bx, y + s - 1); ctx.lineTo(F.tipX, F.tipY);
      ctx.strokeStyle = th.paper; ctx.lineWidth = 4.5 * u; ctx.lineCap = 'round'; ctx.stroke();
      ctx.strokeStyle = col; ctx.lineWidth = 2 * u; ctx.stroke(); ctx.lineCap = 'butt';
      ctx.beginPath(); ctx.arc(F.tipX, F.tipY, 3.2 * u, 0, 6.2832); ctx.fillStyle = col; ctx.fill();
      ctx.strokeStyle = th.paper; ctx.lineWidth = 1.5 * u; ctx.stroke();
    }
    ctx.beginPath(); ctx.roundRect(x, y, w, s, r);
    if (!lead) { ctx.moveTo(bx - pw, y + s - 0.5); ctx.lineTo(F.tipX, F.tipY); ctx.lineTo(bx + pw, y + s - 0.5); }
    // a paper halo keeps the flag off any stage fill, wall or neighbouring tile
    ctx.lineJoin = 'round'; ctx.strokeStyle = th.paper; ctx.lineWidth = 3.5 * u; ctx.stroke();
    ctx.fillStyle = col; ctx.fill();
    const gs = s * 0.6;
    glyph(ctx, E.M.P.LENS[F.lens]?.glyph ?? null, x + (w - gs) / 2, y + (s - gs) / 2, gs, th.paper, Math.max(1.8, s * 0.085));
    const cnt = F.fids.length;
    if (cnt > 1) {
      // the cluster's count, a tag on the flag's top right corner (12 px text: the floor)
      const label = cnt > 99 ? '99+' : (COUNTS[cnt] ||= String(cnt)), tw = E.tx.w(label, nf), bh = 17 * u, bw = Math.max(bh, tw + 9 * u);
      const bx = x + w - bw * 0.55, by = y - bh * 0.45;
      ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, bh / 2);
      ctx.fillStyle = th.paper; ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 1.6 * u; ctx.stroke();
      ctx.textAlign = 'center'; drawText(ctx, label, bx + bw / 2, by + bh * 0.72, nf, th.inkHi); ctx.textAlign = 'left';
    }
  }
  ctx.restore();
}

/** The topmost flag at (px, py) in the given frame's flags, with a few px of slack. */
export function flagAt(E: Engine, flags: readonly Flag[], px: number, py: number): Flag | null {
  const sl = 3 * E.U;
  for (const F of flags) if (px >= F.x - sl && px <= F.x + F.w + sl && py >= F.y - sl && py <= F.tipY + sl) return F;
  return null;
}
