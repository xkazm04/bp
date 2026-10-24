// Indexes over a scan snapshot, built in one pass and cached by the measurements table's identity (a
// delta that brings no measurement keeps it, so nothing is recomputed). Pure and free of '@/' value
// imports: Node runs scripts/check-scan-wire.ts over it as-is.
import type { Measurement, Run, ScanSnapshot } from './types.ts';

/**
 * v4: a severity tier as a sort key, ascending: tier 0 (stop-ship) .. 3 (backlog), and an untriaged item (no tier)
 * after tier 3. The ledger and the review queue order by it first, then by their own order; with no tier anywhere
 * every key is 4 and their order is exactly what it was.
 */
export const tierRank = (tier: number | undefined): number => (tier === undefined ? 4 : tier);

/** The latest run (by start), or null. */
export function latestRun(scan: Pick<ScanSnapshot, 'runs'> | undefined): Run | null {
  let r: Run | null = null;
  for (const x of scan?.runs ?? []) if (!r || x.started_at > r.started_at) r = x;
  return r;
}

/**
 * Whether a reading counts as the feature's state: an `after` reading (v2) was taken on an unmerged pack branch,
 * so it is that item's evidence, never the product's current value - as store.mjs `latest` and `gaps` read it.
 * Unlinked readings and `before` readings count.
 */
export const isCurrent = (m: Pick<Measurement, 'phase'>): boolean => m.phase !== 'after';

export interface MeasureIndex {
  /** feature + lens + metric -> its latest current reading (isCurrent; a tie on the time goes to the higher id). */
  latest: Map<string, Measurement>;
  /** run + lens -> the features that run has measured on that lens. */
  measured: Map<string, Set<string>>;
}
export const metricKey = (feature: string, lens: string, metric: string) => feature + '\u0000' + lens + '\u0000' + metric;
const runLensKey = (run: string, lens: string) => run + '\u0000' + lens;

const INDEX = new WeakMap<readonly Measurement[], MeasureIndex>();
export function measureIndex(measurements: readonly Measurement[]): MeasureIndex {
  let ix = INDEX.get(measurements);
  if (ix) return ix;
  ix = { latest: new Map(), measured: new Map() };
  for (const m of measurements) {
    const k = metricKey(m.feature, m.lens, m.metric), p = ix.latest.get(k);
    // A tie on measured_at goes to the higher id, as track.ts's `latest` and compare.ts's byMeasure both do.
    // `>=` alone made the answer the LAST row of whatever order the caller held, which the store does not promise.
    if (isCurrent(m) && (!p || m.measured_at > p.measured_at || (m.measured_at === p.measured_at && m.id > p.id))) ix.latest.set(k, m);
    const rk = runLensKey(m.run_id, m.lens);
    let s = ix.measured.get(rk);
    if (!s) ix.measured.set(rk, (s = new Set()));
    s.add(m.feature);
  }
  INDEX.set(measurements, ix);
  return ix;
}

/** lens -> feature -> its newest current reading's time (isCurrent: a branch reading never counts); cached by the
 *  measurements table's identity, as measureIndex is. What "read recently" means to a scan scope's facts and a Measure plan. */
const LAST_READ = new WeakMap<readonly Measurement[], Map<string, Map<string, number>>>();
export function lastRead(measurements: readonly Measurement[]): Map<string, Map<string, number>> {
  let ix = LAST_READ.get(measurements);
  if (ix) return ix;
  ix = new Map();
  for (const m of measurements) {
    if (!isCurrent(m)) continue;
    const t = Date.parse(m.measured_at);
    if (!Number.isFinite(t)) continue;
    let by = ix.get(m.lens);
    if (!by) ix.set(m.lens, (by = new Map()));
    if (!(by.get(m.feature)! >= t)) by.set(m.feature, t);
  }
  LAST_READ.set(measurements, ix);
  return ix;
}

/** The latest reading of one metric of one feature on one lens. */
export const latestReading = (scan: Pick<ScanSnapshot, 'measurements'> | undefined, feature: string, lens: string, metric: string): Measurement | undefined =>
  scan ? measureIndex(scan.measurements).latest.get(metricKey(feature, lens, metric)) : undefined;

/** The features a run has measured on a lens. */
export const measuredFeatures = (scan: Pick<ScanSnapshot, 'measurements'>, runId: string, lens: string): ReadonlySet<string> =>
  measureIndex(scan.measurements).measured.get(runLensKey(runId, lens)) ?? EMPTY;
const EMPTY: ReadonlySet<string> = new Set();
