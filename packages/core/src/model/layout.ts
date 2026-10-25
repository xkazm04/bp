// Chronological plan layout in world units. Wings run left to right in the order their work began
// (median creation date); inside a bay, features are placed oldest first. The plan is computed once
// per product and never moves: lenses, time and decisions change what places say, not where they are.
//
// Two nestings share the levels. The Kettle sample keeps its hand-made one: a wing is a named group of domains, a
// room is a domain, a bay is a capability. A live product (owner, 2026-10-25) nests one level deeper so a room can
// carry layers inside it: a wing is a domain, a room is a capability, and a bay is the features of one kind in it
// (BAY_KINDS, the kinds VR furnishes rooms by). A kind is what a feature is, not where it is in its life, so a tile
// never changes bay as time or decisions move; a stage would.
import type { Capability, Feature, Structure } from '@bp/core/data';
import { dnum } from './aggregates';
import { WING_DEFS, type WingDef } from './constants';
import type { Building, PDomain, Product } from './product';

export const TW = 160, TH = 76, G = 10, BH = 46, RH = 72, PAD = 16, BB = 12;

export interface Box { x: number; y: number; w: number; h: number }
export interface BldNode extends Box { kind: 'bld'; id: string; i: number; name: string; b: Building; wings: WingNode[]; feats: Feature[] }
export interface WingNode extends Box {
  kind: 'wing'; id: string; def: WingDef; bld: BldNode; rooms: RoomNode[]; feats: Feature[]; cols: number;
  /** The domain a live product's wing is; null in the sample, whose wings group several domains. */
  dom: PDomain | null;
}
export interface RoomNode extends Box {
  kind: 'room'; id: string;
  /** What the room is called: the domain's name in the sample, the capability's in a live product. */
  name: string; code: string;
  /** One line under the name: the domain's summary in the sample, its bays and their counts in a live product ("User flows 3 · Operations 1"). */
  summary: string;
  /** The room's base id, the same at every `?scale` (a scan scope's id): the domain's in the sample, the capability's in a live product. */
  base: string;
  /** The domain the room stands in: the room itself in the sample, its wing's in a live product. */
  d: PDomain;
  /** The capability a live product's room is; null in the sample, whose capabilities are its bays. */
  cap: Capability | null;
  wing: WingNode; bays: BayNode[]; feats: Feature[]; ri: number; /** Right edge of the drawn room label (world units, like labelBox, so a layer at the live camera reads it between rasters), set by the renderer; undefined when no label is drawn. */ labelRight?: number; /** The drawn label's box (world units), set by the renderer; null when no label is drawn. Trouble flags step aside from it. */ labelBox?: Box | null }
export interface BayNode extends Box {
  kind: 'bay'; id: string;
  /** What the bay is called: the capability's name and code in the sample, its kind's name (BAY_KIND_NAME) and no code in a live product. */
  name: string; code: string;
  /** The bay's base id, the same at every `?scale` (a scan scope's id): the capability's in the sample, `<capability>.<kind>` in a live product. */
  base: string;
  /** The capability the bay belongs to: the bay itself in the sample, its room's in a live product. */
  cap: Capability;
  /** The feature kind a live product's bay holds; null in the sample. */
  group: BayKind | null;
  room: RoomNode; tiles: TileNode[]; feats: Feature[]; rib: Box;
}
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

/** The bays of a live product's room, in this order: the feature kinds VR's furniture glyphs stand for; any other kind is `generic`. */
export const BAY_KINDS = ['user_flow', 'capability', 'ops', 'integration', 'generic'] as const;
export type BayKind = (typeof BAY_KINDS)[number];
export const BAY_KIND_NAME: Readonly<Record<BayKind, string>> = { user_flow: 'User flows', capability: 'Capabilities', ops: 'Operations', integration: 'Integrations', generic: 'Other' };
/** The bay a feature of this kind sits in. */
export const bayKind = (kind: string): BayKind => ((BAY_KINDS as readonly string[]).includes(kind) ? (kind as BayKind) : 'generic');
/**
 * Whether a product's rooms are its capabilities (and its bays feature kinds): every live product. The sample's
 * named wings and domain rooms belong to the sample alone; its slug is reserved, so a live product never has it.
 */
export const roomsAreCapabilities = (K: Structure): boolean => K.project.slug !== 'kettle';

/** Wing order is derived from the base data so every product line shares it. */
export function wingOrder(K: Structure): WingDef[] {
  // A live product gets one wing per domain, however its domains happen to be named.
  const defs: WingDef[] = !roomsAreCapabilities(K)
    ? WING_DEFS.map((w) => ({ ...w, doms: w.doms.slice(), letter: '', median: 0 }))
    : K.domains.map((d) => ({ k: d.id, name: d.name, plain: d.summary || d.name, doms: [d.id], art: d.id, letter: '', median: 0 }));
  for (const d of K.domains) if (!defs.some((w) => w.doms.includes(d.id))) defs[defs.length - 1].doms.push(d.id);
  // Only wings that will be laid out get a letter, so letters run A, B, C without gaps.
  const used = defs.filter((w) => K.domains.some((d) => w.doms.includes(d.id)));
  for (const w of used) {
    const ds = K.features.filter((f) => w.doms.includes(f.domain)).map((f) => dnum(f.created)).sort((a, b) => a - b);
    w.median = ds.length ? ds[Math.floor(ds.length / 2)] : 0;
  }
  used.sort((a, b) => a.median - b.median);
  used.forEach((w, i) => { w.letter = String.fromCharCode(65 + i); });
  return used;
}

const bayH = (n: number, c: number) => { const r = Math.ceil(n / c); return BH + r * TH + (r - 1) * G + BB; };
const wingW = (c: number) => 2 * PAD + c * TW + (c - 1) * G;


/** A room before it has a box: what it is, and its bays' features (ids, in the map's order). */
interface RoomSpec { id: string; base: string; name: string; code: string; summary: string; d: PDomain; cap: Capability | null; bays: BaySpec[] }
interface BaySpec { id: string; base: string; name: string; code: string; cap: Capability; group: BayKind | null; feats: string[] }

export function layoutProduct(P: Product): Layout {
  const L: Layout = { blds: [], wings: [], rooms: [], bays: [], tiles: [], TILE: {}, ROOM: {}, BAY: {}, WING: {}, world: { x: 0, y: 0, w: 0, h: 0 }, walk: [], wingDefs: wingOrder(P.base) };
  const capRooms = roomsAreCapabilities(P.base);
  const capBay = (c: Capability): BaySpec => ({ id: c.id, base: c.base, name: c.name, code: c.code, cap: c, group: null, feats: c.features });
  const kindBays = (c: Capability): BaySpec[] => BAY_KINDS
    .map((k) => ({ id: c.id + '.' + k, base: c.base + '.' + k, name: BAY_KIND_NAME[k], code: '', cap: c, group: k, feats: c.features.filter((id) => bayKind(P.F[id].kind) === k) }))
    .filter((b) => b.feats.length);
  const domRoom = (d: PDomain, bays: BaySpec[]): RoomSpec => ({ id: d.id, base: d.base, name: d.name, code: d.code, summary: d.summary, d, cap: null, bays });
  // a live domain with no capability still stands as one empty room, so its wing is drawn
  const roomsOf = (d: PDomain): RoomSpec[] => !capRooms ? [domRoom(d, d.capabilities.map((id) => capBay(P.C[id])))]
    : !d.capabilities.length ? [domRoom(d, [])]
    : d.capabilities.map((id) => { const c = P.C[id], bays = kindBays(c); return { id: c.id, base: c.base, name: c.name, code: c.code, summary: bays.map((b) => b.name + ' ' + b.feats.length).join(' · '), d, cap: c, bays }; });
  const roomH = (r: RoomSpec, c: number) => RH + r.bays.reduce((a, b) => a + bayH(b.feats.length, c), 0) + PAD;

  const layoutBuilding = (b: Building, ox: number, oy: number): BldNode => {
    const doms = P.domains.filter((d) => d.bld === b.i);
    const wings = L.wingDefs
      .map((def) => ({ def, doms: def.doms.map((base) => doms.find((d) => d.base === base)).filter((d): d is PDomain => !!d) }))
      .filter((w) => w.doms.length)
      .map((w) => ({ ...w, rooms: w.doms.flatMap(roomsOf) }));
    // pick a target wing height that makes the building about twice as wide as tall, with even wings.
    // A wing's height per column count does not depend on the target: computed once, not per target.
    const wingH = wings.map((w) => [3, 4, 5, 6].map((c) => w.rooms.reduce((a, r) => a + roomH(r, c), 0)));
    let best: { sc: number; cs: number[]; hs: number[]; Hm: number } | null = null;
    for (let Ht = 500; Ht <= 2600; Ht += 20) {
      const cs: number[] = [], hs: number[] = [];
      let W = 0, Hm = 0;
      for (let wi = 0; wi < wings.length; wi++) {
        let bc: { c: number; h: number; sc: number } | null = null;
        for (let c = 3; c <= 6; c++) {
          const h = wingH[wi][c - 3], sc = Math.abs(h - Ht) + c * 8;
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
      const Wg: WingNode = { kind: 'wing', id: b.i + ':' + w.def.k, def: w.def, bld: B, x, y: oy, w: ww, h: best!.hs[wi], rooms: [], feats: [], cols: c, dom: capRooms ? w.doms[0] : null };
      for (const rs of w.rooms) {
        const rh = roomH(rs, c);
        const R: RoomNode = { kind: 'room', id: rs.id, name: rs.name, code: rs.code, summary: rs.summary, base: rs.base, d: rs.d, cap: rs.cap, wing: Wg, x, y, w: ww, h: rh, bays: [], feats: [], ri: L.rooms.length };
        let by = y + RH, idx = 0;
        for (const bs of rs.bays) {
          const bh = bayH(bs.feats.length, c);
          const inner = bh - BH - BB, rh2 = Math.min(inner * 0.7, 60);
          const Bay: BayNode = {
            kind: 'bay', id: bs.id, name: bs.name, code: bs.code, base: bs.base, cap: bs.cap, group: bs.group, room: R, x: x + PAD, y: by, w: ww - 2 * PAD, h: bh, tiles: [], feats: [],
            rib: { x: x + PAD + 4, y: by + BH + (inner - rh2) / 2, w: ww - 2 * PAD - 8, h: rh2 },
          };
          // oldest first; features created the same day keep the map's order (stable across slugs and clones)
          bs.feats.map((id) => P.F[id]).sort((a, b) => (a.created < b.created ? -1 : a.created > b.created ? 1 : P.FI[a.id] - P.FI[b.id])).forEach((f, i) => {
            const T: TileNode = {
              kind: 'tile', id: f.id, f, bay: Bay, room: R, wing: Wg, idx: ++idx, bi: i, ti: L.tiles.length,
              x: Bay.x + (i % c) * (TW + G), y: by + BH + Math.floor(i / c) * (TH + G), w: TW, h: TH,
            };
            Bay.tiles.push(T); L.TILE[f.id] = T; L.tiles.push(T);
            Bay.feats.push(f); R.feats.push(f); Wg.feats.push(f); B.feats.push(f);
          });
          R.bays.push(Bay); L.BAY[Bay.id] = Bay; L.bays.push(Bay); by += bh;
        }
        Wg.rooms.push(R); L.ROOM[R.id] = R; L.rooms.push(R);
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
