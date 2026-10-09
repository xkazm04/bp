// A live product's model and swarm feed. Kept out of the `@/lib/model` barrel: it imports the scan
// client (`swarmFromScan` lives next to the React hook), and the barrel is also read by server
// components (the variants index), so only the client app (BlueprintApp) imports this module.
import { loadMap, type Swarm } from '@/lib/data';
import { swarmFromScan } from '@/lib/scan/client';
import type { ScanSnapshot } from '@/lib/scan/types';
import { AggCache, Closure } from './aggregates';
import type { Model } from './index';
import { layoutProduct } from './layout';
import type { LiveRef } from './live';
import { buildProduct, type Product } from './product';
import { LIVE_DECIDER, SwarmSim } from './sim';

/**
 * The feed for the sim. A scan names no decider and no domain: the decider reads "whoever reviews"
 * and the domain is the feature's own. A question on a feature the map does not have is dropped (it
 * has no place to stand).
 */
export function liveSwarm(P: Product, scan: ScanSnapshot): Swarm {
  const F = P.base.features, dom = new Map(F.map((f) => [f.id, f.domain]));
  const S = swarmFromScan(scan, F.map((f) => f.id));
  return {
    ...S,
    decisions: S.decisions.filter((d) => dom.has(d.feature)).map((d) => ({ ...d, domain: d.domain || dom.get(d.feature)!, decider: d.decider || LIVE_DECIDER })),
  };
}

/**
 * A live product's model: its map and events log (from its route) read the way Kettle's are, and the
 * swarm built from its scan (`liveSwarm`) in live mode. Later scans reach the sim through
 * `engine.feed(liveSwarm(M.P, scan))`, which rebuilds neither the layout nor the engine; only a new
 * structure needs a new model.
 */
export function buildLiveModel(structure: unknown, events: string, scan: ScanSnapshot, live: LiveRef, scale: number, now: () => number, lenses?: string | null): Model {
  const P = buildProduct(loadMap(structure, events, lenses), scale);
  const L = layoutProduct(P);
  return { P, L, sim: new SwarmSim(P, liveSwarm(P, scan), now, { live: true }), agg: new AggCache(P), closure: new Closure(P), live };
}
