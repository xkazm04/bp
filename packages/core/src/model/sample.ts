// The Kettle sample's model. This module imports the sample data (~770 KB of JSON), so it is reached only
// through a dynamic import (BlueprintApp's `import('@bp/core/model/sample')`, or a Node check): never from the
// model barrel, never from live-product code.
import { KETTLE_CONTEXTS, KETTLE_FINDINGS, SWARM, loadProduct } from '@bp/core/data/sample';
import type { LensEntry } from '@bp/core/standard/types';
import { AggCache, Closure } from './aggregates';
import type { Model } from './index';
import { layoutProduct } from './layout';
import { buildProduct } from './product';
import { SwarmSim } from './sim';
import { ScanSim } from './scan-sim';

/**
 * Build everything the app needs for one `?scale=N` and lens toggle (`?lenses=`). The map is read and its
 * health evaluated once per data load (cached by the loader); this adds the clones and the layout.
 * `extra` are the session's temporary lenses (kept in the browser, src/lib/scan/temp-lens.ts), appended to the map's.
 */
export function buildModel(scale: number, now: () => number, lenses?: string | null, extra?: readonly LensEntry[]): Model {
  // own copies of the features and their lens records (like buildLiveModel): the scan sim lays readings over them in
  // place, and the loader's cached structure must stay the map's
  const S = loadProduct(lenses, extra);
  const P = buildProduct({ ...S, features: S.features.map((f) => ({ ...f, lens: { ...f.lens } })) }, scale);
  const L = layoutProduct(P);
  const findings = KETTLE_FINDINGS;
  return {
    P, L, sim: new SwarmSim(P, SWARM, now), agg: new AggCache(P), closure: new Closure(P), kettleContexts: KETTLE_CONTEXTS,
    findings, scanSim: new ScanSim({ now: () => Date.now(), findings }),
  };
}
