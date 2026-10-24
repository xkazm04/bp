// The release train over a scan snapshot (lens-scan store v2): an item's before/after evidence and its verdict,
// a pack's and a release's items, the per-pack status counts the triage page groups by, and the accepted items
// waiting for a release. Pure and free of '@/' value imports, so scripts/check-release-train.ts runs it on Node
// as-is. compareOf mirrors store.mjs `compare` (ai-registry skills/lens-scan/scripts/store.mjs): the item's
// `before` and `after` readings (ordered lens, metric, measured_at, id) and its shots paired by (theme, size),
// the latest capture of each phase.
import type { Measurement, Pack, Proposal, ProposalStatus, Release, ScanSnapshot, Shot } from './types.ts';

/** How an item's metric moved between its before and its after reading. */
export type Verdict = 'moved' | 'flat' | 'worse' | 'unmeasured';

/** A pair of captures of one (theme, size), each the latest of its phase. */
export interface ShotPair { theme?: string; size?: string; before?: Shot; after?: Shot }

export interface Comparison {
  p: Proposal;
  /** The item's `before` readings, every metric it was measured on. */
  before: Measurement[];
  after: Measurement[];
  shots: ShotPair[];
  verdict: Verdict;
  /** The readings the verdict compares (the latest of each phase for the item's own lens and metric), when there are both. */
  from?: Measurement;
  to?: Measurement;
  /** The direction the verdict was judged in (verdictOf): the lens field's `better`, else the expected delta's sign. */
  dir?: 'up' | 'down';
}

/** The lens entries a product carries (its map's `lenses[]`): only what a direction lookup needs. */
export interface LensFields { id: string; manifest?: { fields?: readonly { key: string; metric?: { better: 'up' | 'down' } }[] } }

/** The direction a lens field is better in, from the lens manifest; undefined when the field is not a metric. */
export function betterOf(lenses: readonly LensFields[] | undefined, lens: string, metric: string): 'up' | 'down' | undefined {
  return lenses?.find((l) => l.id === lens)?.manifest?.fields?.find((f) => f.key === metric)?.metric?.better;
}

const byMeasure = (a: Measurement, b: Measurement) =>
  a.lens < b.lens ? -1 : a.lens > b.lens ? 1 : a.metric < b.metric ? -1 : a.metric > b.metric ? 1
    : a.measured_at < b.measured_at ? -1 : a.measured_at > b.measured_at ? 1 : a.id - b.id;
const byCapture = (a: Shot, b: Shot) => (a.captured_at < b.captured_at ? -1 : a.captured_at > b.captured_at ? 1 : a.id - b.id);

/** One frame at 60 Hz: a timing below it cannot be told apart from the display's own interval. */
export const FRAME_MS = 16.7;

/** Baseline runs (several `before` readings of one metric): their median, spread (max - min) and the noise a change
 *  must exceed to count, the larger of the spread and, for a timing in ms, one frame. One reading: spread 0. */
export interface RunStats { runs: number[]; median: number; spread: number; noise: number }
export function runStats(values: readonly number[], unit?: string): RunStats {
  const runs = [...values].sort((a, b) => a - b), n = runs.length, mid = n >> 1;
  const median = n === 0 ? NaN : n % 2 ? runs[mid] : (runs[mid - 1] + runs[mid]) / 2;
  const spread = n ? runs[n - 1] - runs[0] : 0;
  return { runs, median, spread, noise: Math.max(spread, unit === 'ms' && n > 1 ? FRAME_MS : 0) };
}

/** The verdict with what it was judged from: one judgement every cell renders (the chip, the change's tone, the sentence,
 *  the row's before figure), so none of them re-derives the direction, the baseline or the noise test. */
export interface Judgement {
  verdict: Verdict;
  /** The readings compared (the latest of each phase), when there are both and a verdict could be reached on them. */
  from?: Measurement;
  to?: Measurement;
  /** The direction better is in: the lens field's `better`, else the sign of the expected delta; absent when neither says. */
  dir?: 'up' | 'down';
  /** The baseline: the median of several `before` readings, else the one reading. Set whenever there is a `before`. */
  base?: number;
  /** to - base, when there is an after. */
  delta?: number;
  /** The baseline runs' statistics, when there are several. */
  stats?: RunStats;
}

/**
 * The verdict on one item: its metric's `before` against its latest `after` reading (same lens and metric). One
 * `before` reading is compared as it is; several are baseline runs, and the after is compared with their median, a
 * change within their noise (runStats) reading `flat`. The direction is the lens field's `better` (manifest), else the
 * sign of the item's expected delta. No metric, or a missing reading on either side: `unmeasured`. A reading that did
 * not move needs no direction and reads `flat`; one that MOVED without a direction is `unmeasured`, because nothing
 * says which way is better. The judgement's figures (dir, base, delta, stats) are returned beside the verdict.
 */
export function verdictOf(p: Proposal, before: readonly Measurement[], after: readonly Measurement[], lenses?: readonly LensFields[]): Judgement {
  if (!p.metric) return { verdict: 'unmeasured' };
  const mine = (m: Measurement) => m.lens === p.lens && m.metric === p.metric;
  const last = (xs: readonly Measurement[]) => { let r: Measurement | undefined; for (const m of xs) if (mine(m) && (!r || byMeasure(r, m) <= 0)) r = m; return r; };
  const from = last(before), to = last(after);
  if (!from) return { verdict: 'unmeasured' };
  const dir = betterOf(lenses, p.lens, p.metric) ?? (p.expected_delta ? (p.expected_delta > 0 ? 'up' : 'down') : undefined);
  const runs = before.filter(mine);
  const s = runs.length > 1 ? runStats(runs.map((m) => m.value), from.unit) : undefined;
  const j: Omit<Judgement, 'verdict'> = { base: s ? s.median : from.value };
  if (dir) j.dir = dir;
  if (s) j.stats = s;
  if (!to) return { verdict: 'unmeasured', ...j };
  const d = (j.delta = to.value - j.base!);
  if (d === 0 || (s && Math.abs(d) <= s.noise)) return { verdict: 'flat', from, to, ...j };
  if (!dir) return { verdict: 'unmeasured', ...j };
  return { verdict: (d > 0) === (dir === 'up') ? 'moved' : 'worse', from, to, ...j };
}

/** One item's before/after evidence and verdict; null for an id the scan does not hold. */
export function compareOf(scan: Pick<ScanSnapshot, 'proposals' | 'measurements' | 'shots'>, proposalId: string, lenses?: readonly LensFields[]): Comparison | null {
  const p = scan.proposals.find((x) => x.id === proposalId);
  if (!p) return null;
  const before: Measurement[] = [], after: Measurement[] = [];
  for (const m of scan.measurements) if (m.proposal_id === p.id) { if (m.phase === 'before') before.push(m); else if (m.phase === 'after') after.push(m); }
  before.sort(byMeasure); after.sort(byMeasure);
  const pairs = new Map<string, ShotPair>();
  for (const s of scan.shots.filter((x) => x.proposal_id === p.id && x.phase).sort(byCapture)) {
    const k = JSON.stringify([s.theme ?? null, s.size ?? null]);
    let pair = pairs.get(k);
    if (!pair) { pair = {}; if (s.theme !== undefined) pair.theme = s.theme; if (s.size !== undefined) pair.size = s.size; pairs.set(k, pair); }
    pair[s.phase!] = s; // in capture order: the latest of each phase wins
  }
  const v = verdictOf(p, before, after, lenses);
  const out: Comparison = { p, before, after, shots: [...pairs.values()], verdict: v.verdict };
  if (v.from) out.from = v.from;
  if (v.to) out.to = v.to;
  if (v.dir) out.dir = v.dir;
  return out;
}

const byCreated = (a: Proposal, b: Proposal) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** A pack's items, as store.mjs `proposals --pack` orders them (created_at, id). */
export const packItems = (scan: Pick<ScanSnapshot, 'proposals'>, packId: string): Proposal[] =>
  scan.proposals.filter((p) => p.pack_id === packId).sort(byCreated);

/** A release's items (created_at, id). */
export const releaseItems = (scan: Pick<ScanSnapshot, 'proposals'>, relId: string): Proposal[] =>
  scan.proposals.filter((p) => p.release_id === relId).sort(byCreated);

/** Accepted items no release holds yet: what a new release takes by default (store.mjs `release-add` takes only these). */
export const unreleased = (scan: Pick<ScanSnapshot, 'proposals'>): Proposal[] =>
  scan.proposals.filter((p) => p.status === 'accepted' && !p.release_id).sort(byCreated);

/** A pack with its items counted by status (as store.mjs `packs` reports `items`), and its items. */
export interface PackGroup { pack: Pack; counts: Partial<Record<ProposalStatus, number>>; items: Proposal[] }

/** Every pack of the scan (oldest first, as the snapshot holds them) with its status counts; `lens` keeps that lens's packs. */
export function packGroups(scan: Pick<ScanSnapshot, 'packs' | 'proposals'>, lens?: string): PackGroup[] {
  const by = new Map<string, Proposal[]>();
  for (const p of scan.proposals) if (p.pack_id) { let a = by.get(p.pack_id); if (!a) by.set(p.pack_id, (a = [])); a.push(p); }
  return scan.packs.filter((k) => lens === undefined || k.lens === lens).map((pack) => {
    const items = (by.get(pack.id) ?? []).sort(byCreated), counts: Partial<Record<ProposalStatus, number>> = {};
    for (const p of items) counts[p.status] = (counts[p.status] ?? 0) + 1;
    return { pack, counts, items };
  });
}

/** Items of a pack still waiting for a person's triage (built, `done` or `failed`). */
export const awaitingTriage = (g: PackGroup): number => (g.counts.done ?? 0) + (g.counts.failed ?? 0);

/** A release by id. */
export const releaseOf = (scan: Pick<ScanSnapshot, 'releases'>, relId: string): Release | undefined => scan.releases.find((r) => r.id === relId);
