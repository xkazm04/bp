// Aggregates over places (building, wing, room, bay) and time helpers. Everything the plan says about
// a place is computed here once per (time, window) and cached, never per frame.
import type { Feature, Health, Stage, ViewId } from '@/lib/data';
import type { Product } from './product';

export const dnum = (d: string) => Date.parse(d + 'T00:00:00Z') / 864e5;
export function addDays(d: string, n: number): string {
  const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10);
}
const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
export function fmtD(d: string): string { return MON[+d.slice(5, 7) - 1] + ' ' + d.slice(8, 10); }
export const isLiveSt = (s: Stage | null) => s === 'live' || s === 'flagged';

/**
 * The stage a feature had on date `d`, replayed from the events log: the `to` of its last stage (or
 * feature-added) event at or before `d` (spec 10). null = not yet on the drawing, or unknown "now".
 */
export function stageAt(f: Feature, d: string, asOf: string): Stage | null {
  if (d >= asOf) return f.stage;
  let s: Stage | null = null;
  for (const h of f.revs) { if (h.date > d) break; s = h.stage; }
  return s;
}
/** The stage change inside the "what changed" window ending at `t`, if any (from the events log). */
export function deltaWin(f: Feature, t: string, delta: number): { stage: Stage; date: string } | null {
  const from = addDays(t, -delta);
  for (let i = f.revs.length - 1; i >= 0; i--) { const h = f.revs[i]; if (h.date > from && h.date <= t) return h; }
  return null;
}
export function revAt(weeks: string[], d: string): number { let r = 0; weeks.forEach((w, i) => { if (w <= d) r = i + 1; }); return r || 1; }

/** A feature's health under a view: General = worst-of over enabled lenses (computed at load), else that lens's. */
export function lensHealth(f: Feature, v: ViewId): Health { return v === 'general' ? f.health : f.lens[v]?.h ?? 'unmeasured'; }

export interface Counts {
  n: number; live: number; flagged: number; build: number; paper: number; dep: number; none: number; chg: number;
}
export type HealthCounts = Record<Health, number>;

/** Transitive "used by" closure: what breaks if this breaks. */
export class Closure {
  private memo = new Map<string, string[]>();
  constructor(private P: Product) {}
  of(id: string): string[] {
    const hit = this.memo.get(id); if (hit) return hit;
    const seen = new Set<string>(), q = [id], out: string[] = [];
    while (q.length) {
      const x = q.shift()!;
      for (const u of this.P.F[x].usedBy) if (!seen.has(u) && u !== id) { seen.add(u); out.push(u); q.push(u); }
    }
    this.memo.set(id, out);
    return out;
  }
}

/** Memoised place aggregates. Keys are place ids; invalidated when the time or the window changes. */
export class AggCache {
  private counts = new Map<string, Counts>();
  private health = new Map<string, HealthCounts>();
  private key = '';
  constructor(private P: Product) {}
  setTime(t: string, delta: number) {
    const k = t + '|' + delta;
    if (k !== this.key) { this.key = k; this.counts.clear(); }
  }
  get timeKey() { return this.key; }
  countsOf(id: string, fs: readonly Feature[], t: string, delta: number): Counts {
    this.setTime(t, delta);
    let c = this.counts.get(id);
    if (c) return c;
    c = { n: fs.length, live: 0, flagged: 0, build: 0, paper: 0, dep: 0, none: 0, chg: 0 };
    for (const f of fs) {
      const s = stageAt(f, t, this.P.asOf);
      if (!s) c.none++; else if (s === 'live') c.live++; else if (s === 'flagged') c.flagged++;
      else if (s === 'in-dev' || s === 'in-review') c.build++; else if (s === 'deprecated') c.dep++; else c.paper++;
      if (deltaWin(f, t, delta)) c.chg++;
    }
    this.counts.set(id, c);
    return c;
  }
  /** Health counts under a view (General = overall health). Time independent: health is "now". */
  healthOf(id: string, fs: readonly Feature[], v: ViewId): HealthCounts {
    const k = id + '|' + v;
    let h = this.health.get(k);
    if (h) return h;
    h = { good: 0, watch: 0, bad: 0, na: 0, unmeasured: 0 };
    for (const f of fs) h[lensHealth(f, v)]++;
    this.health.set(k, h);
    return h;
  }
}

/** Plain stage summary parts, e.g. ["32 features", "18 live", "8 building", "6 on paper"]. */
export function stageParts(c: Counts, short: boolean): string[] {
  return [c.n + (short ? '' : ' features'), c.live + c.flagged + ' live', c.build + ' building', c.paper + ' on paper'];
}

