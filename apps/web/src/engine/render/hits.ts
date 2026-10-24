// The per-frame hit list: what the pointer can hit is what the frame drew. Each dynamic layer, as it draws a
// target mark, registers its hit region here (agents and the "+N" overflow chip, question pins, room cluster pins,
// track marks, scan chips, then the trouble flags last); Engine.clickAt / hoverAt and its pinAt / trackAt / agentAt readers walk
// the list topmost first. Registration order IS draw order, so a later-drawn mark wins where two overlap and a new
// target layer is hit-testable the moment it registers - no second geometry formula, no second z-order list.
//
// A crossfading mark registers only when drawn at >= 0.5 of its presence (PRESENT), one threshold for every layer.
// A coarse pointer grows each region to the touch floor (TOUCH, 44 px square) around its own centre; a mouse gets
// the region as registered (the layers register target boxes, which already exceed the drawn glyph).
//
// Records are pooled like flags.ts: a frame that fits the pool allocates nothing. No parameter properties (a node
// check imports this file through type stripping).

export type HitKind = 'agent' | 'more' | 'pin' | 'cluster' | 'track' | 'scan' | 'flag';
export interface Hit {
  kind: HitKind;
  /** agent: agent id; more / pin: feature id; cluster: room name; track: track id; scan: job id; flag: feature id. */
  id: string;
  /** agent: index in sim.agents; cluster: room index; scan: view index; otherwise 0. */
  i: number;
  /** agent: the SimAgent; pin: the SimDecision; scan: the ScanView; flag: the Flag record; otherwise null. */
  ref: unknown;
  /** The hit region, screen px. */
  x: number; y: number; w: number; h: number;
}
export interface HitBox { x: number; y: number; w: number; h: number }

/** The touch floor in this repo: a coarse pointer's target is at least this many px square. */
export const TOUCH = 44;
/** A crossfading mark is hit-testable when drawn at >= this share of its presence. */
export const PRESENT = 0.5;

export class HitList {
  /** Pooled records; only the first `n` belong to the current frame. */
  pool: Hit[] = [];
  n = 0;
  reset() { this.n = 0; }
  add(kind: HitKind, id: string, i: number, ref: unknown, x: number, y: number, w: number, h: number): Hit {
    if (this.n === this.pool.length) this.pool.push({ kind: 'agent', id: '', i: 0, ref: null, x: 0, y: 0, w: 0, h: 0 });
    const r = this.pool[this.n++];
    r.kind = kind; r.id = id; r.i = i; r.ref = ref; r.x = x; r.y = y; r.w = w; r.h = h;
    return r;
  }
  /** The box a pointer with minimum target size `min` (0 for a mouse) hits for record `h`. */
  boxOf(h: Hit, min: number, out: HitBox): HitBox {
    const w = Math.max(h.w, min), hh = Math.max(h.h, min);
    out.x = h.x + (h.w - w) / 2; out.y = h.y + (h.h - hh) / 2; out.w = w; out.h = hh;
    return out;
  }
  private inside(h: Hit, px: number, py: number, min: number): boolean {
    const w = Math.max(h.w, min), hh = Math.max(h.h, min), x = h.x + (h.w - w) / 2, y = h.y + (h.h - hh) / 2;
    return px >= x && px <= x + w && py >= y && py <= y + hh;
  }
  /** The topmost region at (px, py), or with `kinds` the topmost of those kinds. */
  at(px: number, py: number, min: number, kinds?: readonly HitKind[]): Hit | null {
    for (let j = this.n - 1; j >= 0; j--) {
      const h = this.pool[j];
      if (kinds && kinds.indexOf(h.kind) < 0) continue;
      if (this.inside(h, px, py, min)) return h;
    }
    return null;
  }
}
