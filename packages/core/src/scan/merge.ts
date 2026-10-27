// Applying a scan delta to a snapshot: the rows of each table replace those with the same key, the rest are appended.
import type { Activity, Coverage, Measurement, Proposal, Run, ScanDelta, ScanSnapshot } from './types.ts';

const ACTIVITY_KEEP = 200;

/** Rows of `ys` replace rows of `xs` with the same key, the rest are appended; `xs` is returned as is when nothing came. */
export function upsert<T>(xs: T[], ys: T[] | undefined, key: (t: T) => string | number): T[] {
  if (!ys?.length) return xs;
  const at = new Map<string | number, number>(), out = xs.slice();
  out.forEach((x, i) => at.set(key(x), i));
  for (const y of ys) { const k = key(y), i = at.get(k); if (i === undefined) { at.set(k, out.length); out.push(y); } else out[i] = y; }
  return out;
}
const byId = (r: { id: string | number }) => r.id;
/** Apply a delta; tables the delta does not touch keep their identity (cheap change checks downstream). */
export function mergeScan(s: ScanSnapshot, d: ScanDelta): ScanSnapshot {
  let activity = upsert<Activity>(s.activity, d.activity, byId);
  if (activity !== s.activity) { activity.sort((a, b) => a.id - b.id); if (activity.length > ACTIVITY_KEEP) activity = activity.slice(-ACTIVITY_KEEP); }
  return {
    runs: upsert<Run>(s.runs, d.runs, byId),
    measurements: upsert<Measurement>(s.measurements, d.measurements, byId),
    proposals: upsert<Proposal>(s.proposals, d.proposals, byId),
    activity,
    shots: upsert(s.shots, d.shots, byId),
    coverage: upsert<Coverage>(s.coverage, d.coverage, (c) => c.feature + '\u0000' + c.standard),
    packs: upsert(s.packs, d.packs, byId),
    releases: upsert(s.releases, d.releases, byId),
  };
}
