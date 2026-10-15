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

/**
 * The verdict on one item: its metric's latest `before` against its latest `after` reading (same lens and metric).
 * The direction is the lens field's `better` (manifest), else the sign of the item's expected delta. No metric,
 * a missing reading on either side or no direction: `unmeasured`. Equal values: `flat`.
 */
export function verdictOf(p: Proposal, before: readonly Measurement[], after: readonly Measurement[], lenses?: readonly LensFields[]): { verdict: Verdict; from?: Measurement; to?: Measurement } {
  if (!p.metric) return { verdict: 'unmeasured' };
  const last = (xs: readonly Measurement[]) => { let r: Measurement | undefined; for (const m of xs) if (m.lens === p.lens && m.metric === p.metric && (!r || byMeasure(r, m) <= 0)) r = m; return r; };
  const from = last(before), to = last(after);
  if (!from || !to) return { verdict: 'unmeasured' };
  const dir = betterOf(lenses, p.lens, p.metric) ?? (p.expected_delta ? (p.expected_delta > 0 ? 'up' : 'down') : undefined);
  const d = to.value - from.value;
  if (d === 0) return { verdict: 'flat', from, to };
  if (!dir) return { verdict: 'unmeasured' };
  return { verdict: (d > 0) === (dir === 'up') ? 'moved' : 'worse', from, to };
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
