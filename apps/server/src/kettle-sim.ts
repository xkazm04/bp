// The Kettle sample's sims, hosted by this server process (wolf-plan L5.2): one ScanSim and one SwarmSim, built from
// packages/core/data at start and kept in memory only. The routes answer Kettle's scan, scans, waves, dispatch and stream
// from them (packages/core/src/server/kettle-sim.server.ts). Nothing is written: a restart starts the sample afresh.
import { buildModel } from '@bp/core/model/sample';
import type { Model } from '@bp/core/model';
import type { ScanSim } from '@bp/core/model/scan-sim';
import { hostKettle } from '@bp/core/server/kettle-sim.server';

/** What the scan sim needs of the model, as the web app's Kettle binds it: base slugs in layout order, the enabled lenses,
 *  the facet values, and every lens the model knows. */
function bindScan(scan: ScanSim, M: Model): void {
  const P = M.P, base = new Map(P.base.features.map((f) => [f.id, f])), on = new Set(P.lenses.map((l) => l.id));
  const order = [...new Set(M.L.tiles.filter((T) => T.wing.bld.i === 0).map((T) => T.f.slug))];
  scan.bind({
    order,
    manifest: (l) => (on.has(l) ? P.LENS[l]?.manifest : undefined),
    value: (f, l, k) => { const v = base.get(f)?.lens[l]?.facet?.values?.[k]; return typeof v === 'number' ? v : undefined; },
    lenses: () => Object.values(P.LENS).map((d) => ({ id: d.id, version: d.manifest.version, source: d.source, enabled: d.i >= 0, manifest: d.manifest, ...(d.temporary ? { temporary: true as const } : {}) })),
  });
}

export function hostKettleSims(): void {
  // The scan sim keeps the sample's waves in globalThis.localStorage when there is one; Node's (--localstorage-file) is a
  // file, so the server hides it and the waves stay in the sim's memory.
  if ((globalThis as { localStorage?: unknown }).localStorage !== undefined) Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true });
  const M = buildModel(1, () => performance.now(), null), scan = M.scanSim;
  if (!scan) throw new Error('the Kettle model came without its scan sim');
  bindScan(scan, M);
  hostKettle({ scan, swarm: M.sim });
}
