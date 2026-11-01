// Axonometric Raise: the plan as it has arrived so far. Objects are kept by id across `structure` chunks so the times
// the engine stamps on them (when a footprint is traced, a room raised, a slab dropped) survive a re-link. Derived
// lists (codes, ordered tiles, the wall segments) are rebuilt from scratch after each chunk.
import type { BBox, BBay, BRoom, BWing, Health, Stage, StructureTile } from '../contract';

export const STAGE_WORD: Readonly<Record<Stage, string>> = {
  live: 'Built', flagged: 'Partly open', 'in-review': 'Inspection', 'in-dev': 'Construction',
  specified: 'Proposed', idea: 'Future', deprecated: 'Demolish',
};
export const STAGES: readonly Stage[] = ['live', 'flagged', 'in-review', 'in-dev', 'specified', 'idea', 'deprecated'];
export const HEALTH_WORD: Readonly<Record<Health, string>> = { good: 'Good', watch: 'Watch', bad: 'In trouble', na: 'Not measured', unmeasured: 'Unmeasured' };
export const HEALTHS: readonly Health[] = ['good', 'watch', 'bad', 'na', 'unmeasured'];
export const KIND_WORD: Readonly<Record<string, string>> = { user_flow: 'User flow', capability: 'Capability', ops: 'Operations', integration: 'Integration' };

export interface Wing extends BWing {
  lvl: 'wing'; i: number; rooms: Room[]; bays: Bay[]; tiles: Tile[];
  /** grid axis chalked, footprint traced, walls raised, first health reading (engine seconds) */
  axisT: number; footT: number; wallT: number; healthT: number;
}
export interface Room extends BRoom { lvl: 'room'; wing: Wing; bays: Bay[]; tiles: Tile[]; code: string; riseT: number }
export interface Bay extends BBay { lvl: 'bay'; room: Room; wing: Wing; tiles: Tile[]; code: string; ruleT: number }
export interface Tile extends StructureTile {
  lvl: 'tile'; bay: Bay; room: Room; wing: Wing; idx: number;
  created: string | null; general: Health | null;
  dropT: number; stageT: number; healthT: number;
}
export type Node = Wing | Room | Bay | Tile;
export interface Wall { x0: number; y0: number; x1: number; y1: number; mx: number; my: number; type: 'wing' | 'room'; owner: Wing | Room }

const INF = Infinity;

export class Model {
  wings: Wing[] = []; rooms: Room[] = []; bays: Bay[] = []; tiles: Tile[] = []; walls: Wall[] = [];
  /** tiles in history order (dated first, oldest first; plan order otherwise) */
  hist: Tile[] = [];
  dated = false;
  historyIn = false;
  private W = new Map<string, Wing>(); private R = new Map<string, Room>(); private B = new Map<string, Bay>(); private T = new Map<string, Tile>();

  constructor(public name: string, public slug: string) {}

  /** Add one chunk; returns the objects that are new in it. Children whose parent is unknown are dropped (the contract
   *  sends parents first). */
  add(c: { wings: BWing[]; rooms: BRoom[]; bays: BBay[]; tiles: StructureTile[] }) {
    const nw: Wing[] = [], nr: Room[] = [], nb: Bay[] = [], nt: Tile[] = [];
    for (const w0 of c.wings) {
      if (this.W.has(w0.id)) continue;
      const w: Wing = { ...w0, lvl: 'wing', i: 0, rooms: [], bays: [], tiles: [], axisT: INF, footT: INF, wallT: INF, healthT: INF };
      this.W.set(w.id, w); nw.push(w);
    }
    for (const r0 of c.rooms) {
      const w = this.W.get(r0.parentId); if (!w || this.R.has(r0.id)) continue;
      const r: Room = { ...r0, lvl: 'room', wing: w, bays: [], tiles: [], code: '', riseT: INF };
      this.R.set(r.id, r); nr.push(r);
    }
    for (const b0 of c.bays) {
      const r = this.R.get(b0.parentId); if (!r || this.B.has(b0.id)) continue;
      const b: Bay = { ...b0, lvl: 'bay', room: r, wing: r.wing, tiles: [], code: '', ruleT: INF };
      this.B.set(b.id, b); nb.push(b);
    }
    for (const t0 of c.tiles) {
      const b = this.B.get(t0.parentId); if (!b || this.T.has(t0.id)) continue;
      const t: Tile = { ...t0, lvl: 'tile', bay: b, room: b.room, wing: b.wing, idx: 0, created: null, general: null, dropT: INF, stageT: INF, healthT: INF };
      this.T.set(t.id, t); nt.push(t);
    }
    this.relink();
    return { wings: nw, rooms: nr, bays: nb, tiles: nt };
  }

  tile(id: string) { return this.T.get(id); }

  relink() {
    this.wings = [...this.W.values()].sort((a, b) => a.order - b.order);
    this.wings.forEach((w, i) => { w.i = i; w.rooms = []; w.bays = []; w.tiles = []; });
    for (const r of this.R.values()) { r.bays = []; r.tiles = []; r.wing.rooms.push(r); }
    this.rooms = [];
    for (const w of this.wings) { w.rooms.sort((a, b) => a.order - b.order); w.rooms.forEach((r, j) => { r.code = w.letter + (j + 1); this.rooms.push(r); }); }
    for (const b of this.B.values()) { b.tiles = []; b.room.bays.push(b); }
    this.bays = [];
    for (const r of this.rooms) { r.bays.sort((a, b) => a.order - b.order); r.bays.forEach((b, k) => { b.code = r.code + '.' + (k + 1); this.bays.push(b); r.wing.bays.push(b); }); }
    for (const t of this.T.values()) t.bay.tiles.push(t);
    this.tiles = [];
    for (const b of this.bays) { b.tiles.sort((a, c) => a.order - c.order); for (const t of b.tiles) { t.idx = this.tiles.length; this.tiles.push(t); b.room.tiles.push(t); b.wing.tiles.push(t); } }
    this.reorderHist();
    // walls: the wing shell, then room partitions (edges not already on the wing perimeter)
    const walls: Wall[] = [];
    const seg = (x0: number, y0: number, x1: number, y1: number, type: Wall['type'], owner: Wing | Room) => walls.push({ x0, y0, x1, y1, mx: (x0 + x1) / 2, my: (y0 + y1) / 2, type, owner });
    for (const w of this.wings) { const { x, y, w: ww, h } = w.box; seg(x, y, x + ww, y, 'wing', w); seg(x + ww, y, x + ww, y + h, 'wing', w); seg(x, y + h, x + ww, y + h, 'wing', w); seg(x, y, x, y + h, 'wing', w); }
    const seen = new Set<string>();
    for (const r of this.rooms) {
      const B = r.box, W = r.wing.box;
      const E: [number, number, number, number][] = [[B.x, B.y, B.x + B.w, B.y], [B.x, B.y + B.h, B.x + B.w, B.y + B.h], [B.x, B.y, B.x, B.y + B.h], [B.x + B.w, B.y, B.x + B.w, B.y + B.h]];
      for (const e of E) {
        const hor = e[1] === e[3];
        if (hor && (e[1] === W.y || e[1] === W.y + W.h)) continue;
        if (!hor && (e[0] === W.x || e[0] === W.x + W.w)) continue;
        const k = e.join(','); if (seen.has(k)) continue; seen.add(k);
        seg(e[0], e[1], e[2], e[3], 'room', r);
      }
    }
    this.walls = walls;
  }

  reorderHist() {
    this.dated = this.tiles.some((t) => t.created);
    this.hist = this.tiles.slice().sort((a, b) => (this.dated ? String(a.created ?? '9999').localeCompare(String(b.created ?? '9999')) : 0) || a.idx - b.idx);
  }

  /** The union of the wings that have arrived, or null before any. */
  known(): BBox | null {
    if (!this.wings.length) return null;
    let x0 = INF, y0 = INF, x1 = -INF, y1 = -INF;
    for (const { box: b } of this.wings) { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
}
