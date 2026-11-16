// One evidence index for the release train: every item's `before` and `after` readings and its shot pairs, grouped by
// proposal once per table and kept per array identity (WeakMap), so a store that hands the same array until it changes
// pays one pass however many items are asked about. compareOf (compare.ts) reads it, and through it the compare panel,
// a rebuild's previous attempt and the next item's prefetch; plan.ts verdictIn, the table's facts (ItemRow factsOf), the
// Release tab's counts and the release history read the same groups, so no surface keeps a grouping of its own
// (scripts/check-train-compare.ts holds a source guard on train/**, and check:train-budget counts the visits).
// The orders are store.mjs `compare`'s (ai-registry skills/lens-scan/scripts/store.mjs): readings by (lens, metric,
// measured_at, id); shots in capture order (captured_at, id), paired by (theme, size), the latest capture of each phase.
// A row with no proposal or no phase is no item's evidence. The groups are shared between callers: read them, never
// change them in place. Pure and free of '@/' value imports, so Node checks import it as it is.
import type { Measurement, Shot } from './types.ts';

/** A pair of captures of one (theme, size), each the latest of its phase. */
export interface ShotPair { theme?: string; size?: string; before?: Shot; after?: Shot }

/** One item's readings by phase, each in (lens, metric, measured_at, id) order. */
export interface Readings { readonly before: readonly Measurement[]; readonly after: readonly Measurement[] }
/** One item's readings and its shot pairs (in the order each (theme, size) was first captured). */
export interface Evidence extends Readings { readonly pairs: readonly ShotPair[] }

export const byMeasure = (a: Measurement, b: Measurement): number =>
  a.lens < b.lens ? -1 : a.lens > b.lens ? 1 : a.metric < b.metric ? -1 : a.metric > b.metric ? 1
    : a.measured_at < b.measured_at ? -1 : a.measured_at > b.measured_at ? 1 : a.id - b.id;
export const byCapture = (a: Shot, b: Shot): number => (a.captured_at < b.captured_at ? -1 : a.captured_at > b.captured_at ? 1 : a.id - b.id);

const NO_MS: readonly Measurement[] = Object.freeze([]), NO_PAIRS: readonly ShotPair[] = Object.freeze([]);
/** An item with no evidence at all. */
export const NO_EVIDENCE: Evidence = Object.freeze({ before: NO_MS, after: NO_MS, pairs: NO_PAIRS });

const READINGS = new WeakMap<readonly Measurement[], ReadonlyMap<string, Readings>>();
/** Every item's readings, one pass over the measurements, kept per array. */
export function readingsIndex(ms: readonly Measurement[]): ReadonlyMap<string, Readings> {
  let out = READINGS.get(ms);
  if (out) return out;
  const by = new Map<string, { before: Measurement[]; after: Measurement[] }>();
  for (const m of ms) {
    if (!m.proposal_id || (m.phase !== 'before' && m.phase !== 'after')) continue;
    let e = by.get(m.proposal_id);
    if (!e) by.set(m.proposal_id, (e = { before: [], after: [] }));
    e[m.phase].push(m);
  }
  for (const e of by.values()) { e.before.sort(byMeasure); e.after.sort(byMeasure); }
  READINGS.set(ms, out = by);
  return out;
}

const PAIRS = new WeakMap<readonly Shot[], ReadonlyMap<string, readonly ShotPair[]>>();
/** Every item's shot pairs, one pass over the shots, kept per array. */
export function pairsIndex(shots: readonly Shot[]): ReadonlyMap<string, readonly ShotPair[]> {
  let out = PAIRS.get(shots);
  if (out) return out;
  const by = new Map<string, Shot[]>();
  for (const s of shots) {
    if (!s.proposal_id || !s.phase) continue;
    let a = by.get(s.proposal_id);
    if (!a) by.set(s.proposal_id, (a = []));
    a.push(s);
  }
  const res = new Map<string, readonly ShotPair[]>();
  for (const [id, xs] of by) {
    const pairs = new Map<string, ShotPair>();
    for (const s of xs.sort(byCapture)) {
      const k = JSON.stringify([s.theme ?? null, s.size ?? null]);
      let pair = pairs.get(k);
      if (!pair) { pair = {}; if (s.theme !== undefined) pair.theme = s.theme; if (s.size !== undefined) pair.size = s.size; pairs.set(k, pair); }
      pair[s.phase!] = s; // in capture order: the latest of each phase wins
    }
    res.set(id, [...pairs.values()]);
  }
  PAIRS.set(shots, out = res);
  return out;
}

const INDEX = new WeakMap<readonly Measurement[], WeakMap<readonly Shot[], ReadonlyMap<string, Evidence>>>();
/** Every item's evidence: the readings and the pairs joined by proposal id; the same Map for the same two arrays. */
export function evidenceIndex(ms: readonly Measurement[], shots: readonly Shot[]): ReadonlyMap<string, Evidence> {
  let per = INDEX.get(ms);
  if (!per) INDEX.set(ms, (per = new WeakMap()));
  let out = per.get(shots);
  if (out) return out;
  const R = readingsIndex(ms), S = pairsIndex(shots), by = new Map<string, Evidence>();
  for (const [id, r] of R) by.set(id, { before: r.before, after: r.after, pairs: S.get(id) ?? NO_PAIRS });
  for (const [id, pairs] of S) if (!by.has(id)) by.set(id, { before: NO_MS, after: NO_MS, pairs });
  per.set(shots, out = by);
  return out;
}
