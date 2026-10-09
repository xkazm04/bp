// Chronological plan layout in world units. Wings run left to right in the order their work began
// (median creation date); inside a bay, features are placed oldest first. The plan is computed once
// per product and never moves: lenses, time and decisions change what places say, not where they are.
import type { Capability, Feature, Kettle } from '@/lib/data';
import { WING_DEFS, type WingDef } from './constants';
import type { Building, PDomain, Product } from './product';

export const TW = 160, TH = 76, G = 10, BH = 46, RH = 72, PAD = 16, BB = 12;

export interface Box { x: number; y: number; w: number; h: number }
export interface BldNode extends Box { kind: 'bld'; id: string; i: number; name: string; b: Building; wings: WingNode[]; feats: Feature[] }
export interface WingNode extends Box { kind: 'wing'; id: string; def: WingDef; bld: BldNode; rooms: RoomNode[]; feats: Feature[]; cols: number }
export interface RoomNode extends Box { kind: 'room'; id: string; d: PDomain; wing: WingNode; bays: BayNode[]; feats: Feature[]; ri: number; /** Right edge of the drawn room label (screen px), set by the renderer. */ labelRight?: number }
export interface BayNode extends Box { kind: 'bay'; id: string; cap: Capability; room: RoomNode; tiles: TileNode[]; feats: Feature[]; rib: Box }
export interface TileNode extends Box { kind: 'tile'; id: string; f: Feature; bay: BayNode; room: RoomNode; wing: WingNode; idx: number; bi: number; ti: number }
export type PlaceNode = BldNode | WingNode | RoomNode | BayNode;

export interface Layout {
  blds: BldNode[]; wings: WingNode[]; rooms: RoomNode[]; bays: BayNode[]; tiles: TileNode[];
  TILE: Record<string, TileNode>; ROOM: Record<string, RoomNode>; BAY: Record<string, BayNode>; WING: Record<string, WingNode>;
  world: Box;
  /** Room order for arrow-key walking. */
  walk: RoomNode[];
  wingDefs: WingDef[];
}

const dnum = (d: string) => Date.parse(d + 'T00:00:00Z') / 864e5;

/** Wing order is derived from the base data so every product line shares it. */
export function wingOrder(K: Kettle): WingDef[] {
  const defs = WING_DEFS.map((w) => ({ ...w, doms: w.doms.slice(), letter: '', median: 0 }));
  const known = new Set(defs.flatMap((w) => w.doms));
  for (const d of K.domains) if (!known.has(d.id)) defs[defs.length - 1].doms.push(d.id);
  for (const w of defs) {
    const ds = K.features.filter((f) => w.doms.includes(f.domain)).map((f) => dnum(f.created)).sort((a, b) => a - b);
    w.median = ds.length ? ds[Math.floor(ds.length / 2)] : 0;
  }
  defs.sort((a, b) => a.median - b.median);
  defs.forEach((w, i) => { w.letter = String.fromCharCode(65 + i); });
  return defs;
}

const bayH = (n: number, c: number) => { const r = Math.ceil(n / c); return BH + r * TH + (r - 1) * G + BB; };
const wingW = (c: number) => 2 * PAD + c * TW + (c - 1) * G;
const byCreated = (a: Feature, b: Feature) => (a.created < b.created ? -1 : a.created > b.created ? 1 : a.id < b.id ? -1 : 1);

export function layoutProduct(P: Product): Layout {
  const L: Layout = { blds: [], wings: [], rooms: [], bays: [], tiles: [], TILE: {}, ROOM: {}, BAY: {}, WING: {}, world: { x: 0, y: 0, w: 0, h: 0 }, walk: [], wingDefs: wingOrder(P.base) };
  const roomH = (d: PDomain, c: number) => RH + d.capabilities.reduce((a, id) => a + bayH(P.C[id].features.length, c), 0) + PAD;

  const layoutBuilding = (b: Building, ox: number, oy: number): BldNode => {
    const doms = P.domains.filter((d) => d.bld === b.i);
    const wings = L.wingDefs
      .map((def) => ({ def, doms: def.doms.map((base) => doms.find((d) => d.base === base)).filter((d): d is PDomain => !!d) }))
      .filter((w) => w.doms.length);
    // pick a target wing height that makes the building about twice as wide as tall, with even wings
    let best: { sc: number; cs: number[]; hs: number[]; Hm: number } | null = null;
    for (let Ht = 500; Ht <= 2600; Ht += 20) {
      const cs: number[] = [], hs: number[] = [];
      let W = 0, Hm = 0;
      for (const w of wings) {
        let bc: { c: number; h: number; sc: number } | null = null;
        for (let c = 3; c <= 6; c++) {
          const h = w.doms.reduce((a, d) => a + roomH(d, c), 0), sc = Math.abs(h - Ht) + c * 8;
          if (!bc || sc < bc.sc) bc = { c, h, sc };
        }
        cs.push(bc!.c); hs.push(bc!.h); W += wingW(bc!.c); Hm = Math.max(Hm, bc!.h);
      }
      const mean = hs.reduce((a, v) => a + v, 0) / hs.length;
      const sd = Math.sqrt(hs.reduce((a, v) => a + (v - mean) * (v - mean), 0) / hs.length);
      const sc = Math.abs(Math.log(W / Hm / 2.05)) + 0.8 * sd / Hm;
      if (!best || sc < best.sc - 1e-9) best = { sc, cs, hs, Hm };
    }
    const B: BldNode = { kind: 'bld', id: 'B' + b.i, i: b.i, name: b.name, b, x: ox, y: oy, w: 0, h: best!.Hm, wings: [], feats: [] };
    let x = ox;
    wings.forEach((w, wi) => {
      const c = best!.cs[wi], ww = wingW(c);
      let y = oy;
      const Wg: WingNode = { kind: 'wing', id: b.i + ':' + w.def.k, def: w.def, bld: B, x, y: oy, w: ww, h: best!.hs[wi], rooms: [], feats: [], cols: c };
      for (const d of w.doms) {
        const rh = roomH(d, c);
        const R: RoomNode = { kind: 'room', id: d.id, d, wing: Wg, x, y, w: ww, h: rh, bays: [], feats: [], ri: L.rooms.length };
        let by = y + RH, idx = 0;
        for (const cid of d.capabilities) {
          const cap = P.C[cid], bh = bayH(cap.features.length, c);
          const inner = bh - BH - BB, rh2 = Math.min(inner * 0.7, 60);
          const Bay: BayNode = {
            kind: 'bay', id: cid, cap, room: R, x: x + PAD, y: by, w: ww - 2 * PAD, h: bh, tiles: [], feats: [],
            rib: { x: x + PAD + 4, y: by + BH + (inner - rh2) / 2, w: ww - 2 * PAD - 8, h: rh2 },
          };
          cap.features.map((id) => P.F[id]).sort(byCreated).forEach((f, i) => {
            const T: TileNode = {
              kind: 'tile', id: f.id, f, bay: Bay, room: R, wing: Wg, idx: ++idx, bi: i, ti: L.tiles.length,
              x: Bay.x + (i % c) * (TW + G), y: by + BH + Math.floor(i / c) * (TH + G), w: TW, h: TH,
            };
            Bay.tiles.push(T); L.TILE[f.id] = T; L.tiles.push(T);
            Bay.feats.push(f); R.feats.push(f); Wg.feats.push(f); B.feats.push(f);
          });
          R.bays.push(Bay); L.BAY[cid] = Bay; L.bays.push(Bay); by += bh;
        }
        Wg.rooms.push(R); L.ROOM[d.id] = R; L.rooms.push(R);
        y += rh;
      }
      B.wings.push(Wg); L.wings.push(Wg); L.WING[Wg.id] = Wg; x += ww;
    });
    B.w = x - ox;
    L.blds.push(B);
    return B;
  };

  const first = layoutBuilding(P.buildings[0], 0, 0);
  const cols = P.scale <= 2 ? P.scale : P.scale <= 4 ? 2 : 3, GX = 460, GY = 1040;
  for (let i = 1; i < P.buildings.length; i++) layoutBuilding(P.buildings[i], (i % cols) * (first.w + GX), Math.floor(i / cols) * (first.h + GY));
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const b of L.blds) { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
  L.world = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  L.walk = L.rooms.slice();
  return L;
}

export function inside(o: Box, x: number, y: number): boolean {
  return x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h;
}
