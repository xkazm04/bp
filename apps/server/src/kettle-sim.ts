// The Kettle sample's sims, hosted by this server process (wolf-plan L5.2): one ScanSim and one SwarmSim, built from
// packages/core/data at start and kept in memory only. The routes answer Kettle's scan, scans, waves, dispatch and stream
// from them (packages/core/src/server/kettle-sim.server.ts). Nothing is written: a restart starts the sample afresh.
import { buildModel } from '@bp/core/model/sample';
import { bindKettleScan } from '@bp/core/model/scan-sim';
import { hostKettle } from '@bp/core/server/kettle-sim.server';

export function hostKettleSims(): void {
  // The scan sim keeps the sample's waves in globalThis.localStorage when there is one; Node's (--localstorage-file) is a
  // file, so the server hides it and the waves stay in the sim's memory.
  if ((globalThis as { localStorage?: unknown }).localStorage !== undefined) Object.defineProperty(globalThis, 'localStorage', { value: undefined, configurable: true });
  const M = buildModel(1, () => performance.now(), null), scan = M.scanSim;
  if (!scan) throw new Error('the Kettle model came without its scan sim');
  bindKettleScan(scan, M); // the web app's Kettle binds it the same way
  hostKettle({ scan, swarm: M.sim });
}
