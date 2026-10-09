export * from './constants';
export * from './product';
export * from './layout';
export * from './aggregates';
export * from './sim';
export * from './search';
export * from './lens';

import { SWARM, loadProduct } from '@/lib/data';
import { buildProduct, type Product } from './product';
import { layoutProduct, type Layout } from './layout';
import { AggCache, Closure } from './aggregates';
import { SwarmSim } from './sim';
import { AWAY_SINCE } from './constants';

export interface Model {
  P: Product;
  L: Layout;
  sim: SwarmSim;
  agg: AggCache;
  closure: Closure;
}

/**
 * Build everything the app needs for one `?scale=N` and lens toggle (`?lenses=`). The map is read and its
 * health evaluated once per data load (cached by the loader); this adds the clones and the layout.
 */
export function buildModel(scale: number, now: () => number, lenses?: string | null): Model {
  const P = buildProduct(loadProduct(lenses), scale);
  const L = layoutProduct(P);
  return { P, L, sim: new SwarmSim(P, SWARM, now), agg: new AggCache(P), closure: new Closure(P) };
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
