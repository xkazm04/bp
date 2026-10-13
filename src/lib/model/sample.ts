// The Kettle sample's model. This module imports the sample data (~770 KB of JSON), so it is reached only
// through a dynamic import (BlueprintApp's `import('@/lib/model/sample')`, or a Node check): never from the
// model barrel, never from live-product code.
import { KETTLE_CONTEXTS, KETTLE_FINDINGS, SWARM, loadProduct } from '@/lib/data/sample';
import type { LensEntry } from '@/lib/standard/types';
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
  const P = buildProduct(loadProduct(lenses, extra), scale);
  const L = layoutProduct(P);
  const findings = KETTLE_FINDINGS;
  return {
    P, L, sim: new SwarmSim(P, SWARM, now), agg: new AggCache(P), closure: new Closure(P), kettleContexts: KETTLE_CONTEXTS,
    findings, scanSim: new ScanSim({ now: () => Date.now(), findings }),
  };
}
