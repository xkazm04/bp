export * from './constants';
export * from './product';
export * from './layout';
export * from './aggregates';
export * from './sim';
export * from './search';
export * from './lens';
export * from './live';

import { type Product } from './product';
import { type Layout } from './layout';
import { type AggCache, type Closure } from './aggregates';
import { type SwarmSim } from './sim';
import { AWAY_SINCE } from './constants';
import type { LiveRef } from './live';

export interface Model {
  P: Product;
  L: Layout;
  sim: SwarmSim;
  agg: AggCache;
  closure: Closure;
  /** Set for a live product (`?product=<slug>`); absent for Kettle. */
  live?: LiveRef;
  /** The Kettle sample map's contexts (name -> group); set by `buildModel` in ./sample, absent for a live product (its structure carries them). */
  kettleContexts?: readonly { name: string; group?: string }[];
}

/** "While you were away": overnight activity and the questions asked since 18:00. */
export function morningStats(M: Model) {
  const ev = M.P.base.activity.filter((a) => a.at >= AWAY_SINCE);
  const by: Record<string, number> = {};
  for (const a of ev) by[a.type] = (by[a.type] || 0) + 1;
  const sinceMs = Date.parse(AWAY_SINCE);
  const asked = M.sim.has ? M.sim.decisions.filter((d) => d.open && d.since >= sinceMs).length : 0;
  const done = M.sim.agents.reduce((s, a) => s + a.done, 0);
  return { changes: ev.length, asked, ev, by, spend: M.sim.spend(), done };
}
