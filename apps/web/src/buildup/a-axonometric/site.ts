// Axonometric Raise: the site survey that stands on the light table before the plan does. Pure layout, no drawing.
//   lots    - the code areas (`survey`), chalked as a site plan sized by lines (by files until the lines arrive); once
//             the structure lands they slide out from under the rising wings into a footing strip along its front edge.
//   ghosts  - the decided domains (`outline`), pencilled as wing columns with their capabilities as room plates, laid
//             out the way bp lays wings (columns 532 wide, rooms stacked), so the real wing grows out of its ghost.
// Every rectangle is a tween (a -> b from t0), so a re-layout (lines arriving, a new domain, the hand-over) moves
// instead of jumping. Times are engine seconds.
import type { BBox, OutlineDomain, SurveyArea } from '../contract';

export interface Tween { a: BBox; b: BBox; t0: number; dur: number }
export interface Lot extends SurveyArea { chalkT: number; tw: Tween }
export interface GhostCap { id: string; name: string; tw: Tween; fadeT: number }
export interface Ghost { d: OutlineDomain; rank: number; letter: string; appearT: number; fadeT: number; matched: boolean; tw: Tween; caps: GhostCap[] }

const INF = Infinity;
/** The survey's ground: about the size bp gives a five-wing product, so the plan lands roughly where its site was. */
export const SITE: BBox = { x: 0, y: 0, w: 2660, h: 1100 };
const COL_W = 532, ROOM_H0 = 356, ROOM_H = 222;
/** The footing strip sits this far in front of the plan (clear of the grid bubbles) and is this deep. */
export const BAND_GAP = 240, BAND_H = 96;

const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const smooth = (u: number) => u * u * (3 - 2 * u);

export function rectAt(tw: Tween, t: number, instant = false): BBox {
  if (instant || tw.t0 === -INF) return tw.b;
  const e = smooth(clamp((t - tw.t0) / Math.max(1e-6, tw.dur)));
  if (e >= 1) return tw.b;
  const { a, b } = tw;
  return { x: a.x + (b.x - a.x) * e, y: a.y + (b.y - a.y) * e, w: a.w + (b.w - a.w) * e, h: a.h + (b.h - a.h) * e };
}
/** Retarget a tween from wherever it stands at `now`. */
export function retarget(tw: Tween, to: BBox, now: number, dur: number) {
  const same = tw.b.x === to.x && tw.b.y === to.y && tw.b.w === to.w && tw.b.h === to.h;
  if (same) return;
  tw.a = rectAt(tw, now); tw.b = to; tw.t0 = now; tw.dur = dur;
}
export const still = (b: BBox): Tween => ({ a: b, b, t0: -INF, dur: 1 });

/** Lines once every area has them (the inventory re-send), files before: one unit for the whole sheet. */
export function byLines(lots: Lot[]) { return lots.length > 0 && lots.every((l) => l.lines != null); }
function weights(lots: Lot[]) {
  const lines = byLines(lots);
  const raw = lots.map((l) => Math.max(0, lines ? (l.lines ?? 0) : l.files));
  const tot = raw.reduce((s, v) => s + v, 0) || 1;
  // an empty area still gets a sliver: it exists in the map
  return raw.map((v) => Math.max(v, tot * .006));
}

/** Plan order of the lots: grouped (groups by size), then by size inside a group. */
export function orderLots(lots: Lot[]): Lot[] {
  const wt = weights(lots), w = new Map(lots.map((l, i) => [l, wt[i]]));
  const gsum = new Map<string, number>();
  for (const l of lots) gsum.set(l.group ?? '\u0000' + l.id, (gsum.get(l.group ?? '\u0000' + l.id) ?? 0) + (w.get(l) ?? 0));
  const g = (l: Lot) => l.group ?? '\u0000' + l.id;
  return lots.slice().sort((a, b) => (gsum.get(g(b)) ?? 0) - (gsum.get(g(a)) ?? 0) || g(a).localeCompare(g(b)) || (w.get(b) ?? 0) - (w.get(a) ?? 0) || a.id.localeCompare(b.id));
}

/** Squarified treemap of `vals` into `box` (vals in plan order, any scale). */
function squarify(vals: number[], box: BBox): BBox[] {
  const out: BBox[] = new Array(vals.length);
  const tot = vals.reduce((s, v) => s + v, 0) || 1;
  const scale = (box.w * box.h) / tot;
  const items = vals.map((v, i) => ({ i, a: v * scale }));
  let { x, y, w, h } = box;
  let row: typeof items = [];
  const worst = (r: typeof items, side: number) => {
    const s = r.reduce((q, it) => q + it.a, 0); if (!s) return INF;
    let mx = 0, mn = INF; for (const it of r) { mx = Math.max(mx, it.a); mn = Math.min(mn, it.a); }
    return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
  };
  const lay = (r: typeof items) => {
    const s = r.reduce((q, it) => q + it.a, 0);
    if (w >= h) { const cw = s / h; let yy = y; for (const it of r) { const ch = it.a / cw; out[it.i] = { x, y: yy, w: cw, h: ch }; yy += ch; } x += cw; w -= cw; }
    else { const ch = s / w; let xx = x; for (const it of r) { const cw = it.a / ch; out[it.i] = { x: xx, y, w: cw, h: ch }; xx += cw; } y += ch; h -= ch; }
  };
  for (const it of items) {
    const side = Math.min(w, h);
    if (!row.length || worst([...row, it], side) <= worst(row, side)) row.push(it);
    else { lay(row); row = [it]; }
  }
  if (row.length) lay(row);
  return out;
}

const inset = (b: BBox, d: number): BBox => ({ x: b.x + d, y: b.y + d, w: Math.max(4, b.w - 2 * d), h: Math.max(4, b.h - 2 * d) });

/** The lots as a site plan on SITE: groups first, then the areas inside each group. */
export function siteLayout(lots: Lot[]): Map<string, BBox> {
  const ord = orderLots(lots), w = weights(ord);
  const groups: { key: string; idx: number[] }[] = [];
  ord.forEach((l, i) => { const key = l.group ?? '\u0000' + l.id; const g = groups.find((x) => x.key === key); if (g) g.idx.push(i); else groups.push({ key, idx: [i] }); });
  const gBoxes = squarify(groups.map((g) => g.idx.reduce((s, i) => s + w[i], 0)), SITE);
  const out = new Map<string, BBox>();
  groups.forEach((g, gi) => {
    const inner = squarify(g.idx.map((i) => w[i]), inset(gBoxes[gi], 10));
    g.idx.forEach((i, j) => out.set(ord[i].id, inset(inner[j], 7)));
  });
  return out;
}

/** The footing strip in front of the plan box `E`: one lot per area, width by the same weight, in the same order. */
export function bandBox(E: BBox): BBox { return { x: E.x, y: E.y + E.h + BAND_GAP, w: E.w, h: BAND_H }; }
export function bandLayout(lots: Lot[], E: BBox): Map<string, BBox> {
  const ord = orderLots(lots), w = weights(ord), B = bandBox(E), gap = 8;
  const avail = Math.max(10, B.w - gap * (ord.length - 1)), MIN = 26;
  const tot = w.reduce((s, v) => s + v, 0) || 1;
  // a floor width for the smallest areas, taken out of the rest in proportion
  let ws = w.map((v) => (v / tot) * avail);
  const small = ws.filter((v) => v < MIN).length;
  if (small && small * MIN < avail) { const rest = avail - small * MIN, big = ws.filter((v) => v >= MIN).reduce((s, v) => s + v, 0) || 1; ws = ws.map((v) => (v < MIN ? MIN : (v / big) * rest)); }
  const out = new Map<string, BBox>();
  let x = B.x;
  ord.forEach((l, i) => { out.set(l.id, { x, y: B.y, w: ws[i], h: B.h }); x += ws[i] + gap; });
  return out;
}

/** A pencilled wing column where bp would put the wing of this rank, its capabilities stacked as room plates. */
export function ghostBox(rank: number, caps: number): BBox {
  return { x: rank * COL_W, y: 0, w: COL_W, h: Math.max(ROOM_H * 2, ROOM_H0 + Math.max(0, caps - 1) * ROOM_H) };
}
export function capBox(col: BBox, j: number): BBox {
  const y = j === 0 ? 0 : ROOM_H0 + (j - 1) * ROOM_H;
  return { x: col.x, y: col.y + y, w: col.w, h: j === 0 ? ROOM_H0 : ROOM_H };
}

export function unionAll(boxes: BBox[]): BBox | null {
  if (!boxes.length) return null;
  let x0 = INF, y0 = INF, x1 = -INF, y1 = -INF;
  for (const b of boxes) { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
