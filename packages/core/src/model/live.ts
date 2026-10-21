// A live product's scan as the UI reads it: indexes over the snapshot (a metric's history, the latest
// run, the shots of a feature). Pure, and free of the scan client, so the model barrel can export it
// (the swarm feed and the live model are in live-feed.ts). Ids here are base slugs: at `?scale` > 1 a
// caller passes `baseId(f.id)`.
import { emptyScan, type DecisionBody, type Measurement, type Proposal, type Run, type ScanSnapshot, type Shot } from '@bp/core/scan/types';

/** What the model keeps of a live product: its slug and how a decision reaches its store. */
export interface LiveRef {
  slug: string;
  decide(id: string, body: DecisionBody): Promise<Proposal>;
}

export const EMPTY_SCAN: ScanSnapshot = emptyScan();

import { isCurrent } from '@bp/core/scan/derive';

export { latestRun } from '@bp/core/scan/derive';

const HIST = new WeakMap<Measurement[], Map<string, Measurement[]>>();
const hkey = (feature: string, lens: string, metric: string) => feature + '\u0000' + lens + '\u0000' + metric;
/** A metric's readings for one feature and lens, oldest first (cached per measurements table). A pack's `after`
 *  readings are left out: they were taken on an unmerged branch, not the product (derive.ts isCurrent). */
export function metricHistory(scan: ScanSnapshot | undefined, feature: string, lens: string, metric: string): readonly Measurement[] {
  if (!scan) return [];
  let m = HIST.get(scan.measurements);
  if (!m) {
    m = new Map();
    for (const x of scan.measurements) { if (!isCurrent(x)) continue; const k = hkey(x.feature, x.lens, x.metric); let a = m.get(k); if (!a) m.set(k, (a = [])); a.push(x); }
    for (const a of m.values()) a.sort((p, q) => (p.measured_at < q.measured_at ? -1 : p.measured_at > q.measured_at ? 1 : p.id - q.id));
    HIST.set(scan.measurements, m);
  }
  return m.get(hkey(feature, lens, metric)) ?? [];
}

/** A feature's shots by run, the runs newest first (only runs with shots of this feature). */
export function shotsByRun(scan: ScanSnapshot | undefined, feature: string): { run: Run | null; runId: string; shots: Shot[] }[] {
  if (!scan) return [];
  const by = new Map<string, Shot[]>();
  for (const s of scan.shots) if (s.feature === feature) { let a = by.get(s.run_id); if (!a) by.set(s.run_id, (a = [])); a.push(s); }
  const runs = new Map(scan.runs.map((r) => [r.id, r]));
  return [...by.entries()].map(([runId, shots]) => ({ run: runs.get(runId) ?? null, runId, shots }))
    .sort((a, b) => { const x = a.run?.started_at ?? a.shots[0].captured_at, y = b.run?.started_at ?? b.shots[0].captured_at; return x < y ? 1 : x > y ? -1 : 0; });
}

/** The URL of a shot's file (`path` is relative to the store directory, `shots/...`). */
export function shotUrl(slug: string, s: Shot): string {
  return '/api/products/' + encodeURIComponent(slug) + '/shots/' + s.path.replace(/^shots\//, '').split('/').map(encodeURIComponent).join('/');
}

/** Console errors a shot's harness report records (a count, or a list), or null when no report says - "nobody measured" is not "measured none". */
export function shotErrorsReported(s: Shot): number | null {
  const c = s.report?.consoleErrors;
  return typeof c === 'number' ? c : Array.isArray(c) ? c.length : null;
}
/** The same figure as a plain count: 0 when the report says nothing. Ask shotErrorsReported to tell that from a measured zero. */
export function shotErrors(s: Shot): number { return shotErrorsReported(s) ?? 0; }
