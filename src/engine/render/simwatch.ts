// What the static raster read from the simulation, and the partial re-raster that refreshes just that. The
// plan registers each sim-dependent thing it paints (a tile or ribbon segment: its live rollout / progress
// and whether an agent chip sits on it; a wing or building swarm line: the agent and question counts) with
// the values it painted. On a sim tick the engine asks for the items whose values moved, clears only their
// rectangles in the cached raster and runs the same plan again clipped to them (render/plan.ts culls
// everything else). No full raster runs on a sim tick, and the pixels equal a full raster's.
import type { Feature } from '@/lib/data';
import type { Engine } from '../Engine';
import type { SRect } from './view';

type Stats = ReturnType<Engine['statsOf']>;
const NSIG = 9;
const sigOf = (s: Stats, o: number[]) => { o[0] = s.n; o[1] = s.working; o[2] = s.waiting; o[3] = s.blocked; o[4] = s.failed; o[5] = s.paused; o[6] = s.asks; o[7] = s.high; o[8] = s.mine; };

interface Item {
  swarm: boolean; id: string; fs: readonly Feature[] | null;
  /** The thing's rect (a tile) or the swarm line's rect, in raster screen px. */
  x: number; y: number; w: number; h: number;
  /** A swarm item's whole label block: cleared instead when the agents appear or vanish (the name moves). */
  bx: number; by: number; bw: number; bh: number;
  roll: number; prog: number; ag: number; sig: number[];
}

/** The partial re-raster in progress: plan.ts reads it to cull. Rects are in raster screen px, snapped to device pixels. */
export const patch = { on: false, n: 0, rects: [] as SRect[], x0: 0, y0: 0, x1: 0, y1: 0 };

/** True when a patch is running and the rect (grown by m px) touches none of its clip rects. */
export function patchMiss(x: number, y: number, w: number, h: number, m: number): boolean {
  if (!patch.on) return false;
  if (x > patch.x1 + m || x + w < patch.x0 - m || y > patch.y1 + m || y + h < patch.y0 - m) return true;
  const rs = patch.rects;
  for (let i = 0; i < patch.n; i++) { const r = rs[i]; if (!(x > r.x + r.w + m || x + w < r.x - m || y > r.y + r.h + m || y + h < r.y - m)) return false; }
  return true;
}

export class SimWatch {
  private items = new Map<string, Item>();
  /** Dirty rects of the last collect (pooled). */
  rects: SRect[] = []; n = 0;

  /** A full raster begins: everything is registered again as it paints. */
  begin() { this.items.clear(); }

  private put(key: string, swarm: boolean, id: string, fs: readonly Feature[] | null): Item {
    let it = this.items.get(key);
    if (!it) this.items.set(key, (it = { swarm, id, fs, x: 0, y: 0, w: 0, h: 0, bx: 0, by: 0, bw: 0, bh: 0, roll: -1, prog: 0, ag: 0, sig: swarm ? new Array(NSIG).fill(0) : [] }));
    return it;
  }
  /** A tile (`ribbon` false) or ribbon segment painted at x, y, w, h reads this feature's live rollout, progress and chip presence. */
  tile(E: Engine, ribbon: boolean, f: Feature, x: number, y: number, w: number, h: number) {
    const it = this.put((ribbon ? 'r' : 't') + f.id, false, f.id, null), sim = E.M.sim;
    it.x = x; it.y = y; it.w = w; it.h = h;
    const r = sim.roll[f.id]; it.roll = r == null ? -1 : r; it.prog = sim.prog[f.id] || 0;
    const ag = sim.AGF[f.id]; it.ag = ag && ag.length ? 1 : 0;
  }
  /** A wing or building label painted a swarm line at lx, ly, lw, lh inside the label block bx, by, bw, bh. */
  swarm(id: string, fs: readonly Feature[], s: Stats, lx: number, ly: number, lw: number, lh: number, bx: number, by: number, bw: number, bh: number) {
    const it = this.put('s' + id, true, id, fs);
    it.x = lx; it.y = ly; it.w = lw; it.h = lh; it.bx = bx; it.by = by; it.bw = bw; it.bh = bh;
    sigOf(s, it.sig);
  }

  private add(x: number, y: number, w: number, h: number) {
    const r = this.rects[this.n] || (this.rects[this.n] = { x: 0, y: 0, w: 0, h: 0 });
    r.x = x; r.y = y; r.w = w; r.h = h; this.n++;
  }
  private cur: number[] = new Array(NSIG).fill(0);
  /** The rects whose registered values no longer match the simulation (those items are dropped: repainting registers them again). Returns the count. */
  collect(E: Engine): number {
    this.n = 0;
    const sim = E.M.sim, cur = this.cur;
    for (const [key, it] of this.items) {
      if (it.swarm) {
        const s = E.statsOf(it.id, it.fs!); sigOf(s, cur);
        let diff = false; for (let i = 0; i < NSIG; i++) if (cur[i] !== it.sig[i]) { diff = true; break; }
        if (!diff) continue;
        if ((cur[0] > 0) !== (it.sig[0] > 0)) this.add(it.bx, it.by, it.bw, it.bh); else this.add(it.x, it.y, it.w, it.h);
      } else {
        const r = sim.roll[it.id], ag = sim.AGF[it.id];
        if ((r == null ? -1 : r) === it.roll && (sim.prog[it.id] || 0) === it.prog && (ag && ag.length ? 1 : 0) === it.ag) continue;
        this.add(it.x - 1, it.y - 1, it.w + 2, it.h + 2);
      }
      this.items.delete(key);
    }
    return this.n;
  }
  /** Publish the (already snapped) rects to plan.ts's culling. */
  arm() {
    const p = patch; p.rects = this.rects; p.n = this.n; p.on = true;
    p.x0 = p.y0 = Infinity; p.x1 = p.y1 = -Infinity;
    for (let i = 0; i < this.n; i++) { const r = this.rects[i]; if (r.x < p.x0) p.x0 = r.x; if (r.y < p.y0) p.y0 = r.y; if (r.x + r.w > p.x1) p.x1 = r.x + r.w; if (r.y + r.h > p.y1) p.y1 = r.y + r.h; }
  }
  disarm() { patch.on = false; patch.n = 0; }
}
