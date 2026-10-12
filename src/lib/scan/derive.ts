// Indexes over a scan snapshot, built in one pass and cached by the measurements table's identity (a
// delta that brings no measurement keeps it, so nothing is recomputed). Pure and free of '@/' value
// imports: Node runs scripts/check-scan-wire.ts over it as-is.
import type { Measurement, Run, ScanSnapshot } from './types.ts';

/** The latest run (by start), or null. */
export function latestRun(scan: Pick<ScanSnapshot, 'runs'> | undefined): Run | null {
  let r: Run | null = null;
  for (const x of scan?.runs ?? []) if (!r || x.started_at > r.started_at) r = x;
  return r;
}

export interface MeasureIndex {
  /** feature + lens + metric -> its latest reading (a tie on the time goes to the later row). */
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
    if (!p || m.measured_at >= p.measured_at) ix.latest.set(k, m);
    const rk = runLensKey(m.run_id, m.lens);
    let s = ix.measured.get(rk);
    if (!s) ix.measured.set(rk, (s = new Set()));
    s.add(m.feature);
  }
  INDEX.set(measurements, ix);
  return ix;
}

/** The latest reading of one metric of one feature on one lens. */
export const latestReading = (scan: Pick<ScanSnapshot, 'measurements'> | undefined, feature: string, lens: string, metric: string): Measurement | undefined =>
  scan ? measureIndex(scan.measurements).latest.get(metricKey(feature, lens, metric)) : undefined;

/** The features a run has measured on a lens. */
export const measuredFeatures = (scan: Pick<ScanSnapshot, 'measurements'>, runId: string, lens: string): ReadonlySet<string> =>
  measureIndex(scan.measurements).measured.get(runLensKey(runId, lens)) ?? EMPTY;
const EMPTY: ReadonlySet<string> = new Set();
