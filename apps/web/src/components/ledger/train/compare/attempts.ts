// A rebuild's earlier attempts, for the compare panel: a rework item is judged on whether it did what the person asked
// when they sent the attempt before it back, so the panel reads that attempt's note, figure and screens beside its own.
// attemptChain walks `attempt_of` (at most 50 steps, as ItemRow.tsx's attempt count, so a cycle in the store stops);
// againstPairs sets the previous attempt's AFTER beside the current after, per (theme, size); pairsFor is the one place
// that decides which pairs the screens and the prefetch show. Pure and free of '@/' value imports
// (scripts/check-train-attempts.ts runs it on Node).
import { compareOf, type LensFields, type ShotPair, type Verdict } from '@bp/core/scan/compare';
import type { Measurement, Proposal, ProposalStatus, Shot } from '@bp/core/scan/types';
import type { CompareAgainst } from '../../useLedger';

/** One earlier attempt of an item, as the compare panel shows it. */
export interface Attempt {
  id: string;
  /** Its attempt number: 1 is the first build. */
  n: number;
  status: ProposalStatus;
  /** The triage note that sent it back (a rework's ask). */
  note?: string;
  verdict: Verdict;
  /** Its latest after reading of its own metric, when it has one. */
  after?: Measurement;
  /** Its commit: the after reading's, else the item's. */
  sha?: string;
  /** Its shot pairs (compare.ts compareOf). */
  shots: ShotPair[];
}

/** The train tables an attempt reads. */
export interface AttemptSource {
  byId: ReadonlyMap<string, Proposal>;
  proposals: readonly Proposal[];
  measurements: readonly Measurement[];
  shots: readonly Shot[];
  lenses?: readonly LensFields[];
}

/** The earlier attempts of item `id`, newest first (empty for a first build). Stops at 50 steps or a repeated id. */
export function attemptChain(T: AttemptSource, id: string): Attempt[] {
  const ids: string[] = [], seen = new Set([id]);
  for (let p = T.byId.get(id); p?.attempt_of && ids.length < 50 && !seen.has(p.attempt_of); p = T.byId.get(p.attempt_of)) {
    seen.add(p.attempt_of);
    if (!T.byId.has(p.attempt_of)) break;
    ids.push(p.attempt_of);
  }
  if (!ids.length) return [];
  // compareOf reads, never writes, its tables
  const scan = { proposals: T.proposals as Proposal[], measurements: T.measurements as Measurement[], shots: T.shots as Shot[] };
  return ids.map((x, i): Attempt => {
    const c = compareOf(scan, x, T.lenses)!, p = c.p;
    const after = c.to ?? [...c.after].reverse().find((m) => m.lens === p.lens && m.metric === p.metric);
    const a: Attempt = { id: x, n: ids.length - i, status: p.status, verdict: c.verdict, shots: c.shots };
    if (p.triage_note) a.note = p.triage_note;
    if (after) a.after = after;
    const sha = after?.commit_sha ?? p.commit_sha;
    if (sha) a.sha = sha;
    return a;
  });
}

const same = (x: ShotPair, y: ShotPair) => (x.theme ?? null) === (y.theme ?? null) && (x.size ?? null) === (y.size ?? null);

/** One pair per (theme, size) of the current attempt: `before` the previous attempt's after of the same theme and size
 *  (absent when it has none, so the pair reads 'lone', never the base), `after` the current after. */
export function againstPairs(cur: readonly ShotPair[], prev: readonly ShotPair[]): ShotPair[] {
  return cur.map((s) => {
    const o: ShotPair = {};
    if (s.theme !== undefined) o.theme = s.theme;
    if (s.size !== undefined) o.size = s.size;
    const b = prev.find((q) => same(q, s))?.after;
    if (b) o.before = b;
    if (s.after) o.after = s.after;
    return o;
  });
}

/** Whether an earlier attempt has anything to set beside the current screens: an after capture. */
export const hasPrevShots = (prev: Attempt | null | undefined): prev is Attempt => !!prev?.shots.some((s) => s.after);

/** The pairs the screens show and what they are against: `prev` only when asked for and the item rebuilds an attempt
 *  with screens; otherwise the item's own pairs (a 'prev' carried to a first build never empties the screens). */
export function pairsFor(c: { shots: ShotPair[] }, prev: Attempt | null | undefined, against: CompareAgainst | undefined): { against: CompareAgainst; pairs: ShotPair[] } {
  return against === 'prev' && hasPrevShots(prev) && c.shots.length ? { against: 'prev', pairs: againstPairs(c.shots, prev.shots) } : { against: 'base', pairs: c.shots };
}
