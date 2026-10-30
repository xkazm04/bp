// Pure: the autonomy ladder as the blueprint SHOWS it (scan-finding/1 "Autonomy ladder"). The store's trust_events table is
// the ledger lens-scan writes (its `store.mjs trust` verb computes the transitions); the blueprint reads it and never writes
// trust. A slice's current level is its latest event's to_level; a slice with no event sits at its start level, labelled
// "start": category technical 2, product 0 (an absent category reads product: the cautious one), never above the ceiling,
// which is 1 for risk class secret, authz or money and for every non-technical (product) slice, and 3 otherwise. The same file holds the veto window's rule (`vetoable`),
// which the store's CAS (server/store.server.ts veto) applies in SQL.
import type { Proposal, TrustEvent } from './types.ts';

/** The risk classes whose slices never go above L1 (auto-triage): the machine never builds them unasked. */
export const CEILING_1: ReadonlySet<string> = new Set(['secret', 'authz', 'money']);
export const LEVEL_WORDS = ['propose', 'auto-triage', 'auto-build', 'auto-merge'] as const;

/** A finding's slice key: '<category>|<lens>|<risk_class>|<size>', '-' for an absent part. */
export const sliceOf = (p: Pick<Proposal, 'category' | 'lens' | 'risk_class' | 'size'>): string =>
  [p.category ?? '-', p.lens || '-', p.risk_class ?? '-', p.size ?? '-'].join('|');

/** A slice key's ceiling: 1 for secret / authz / money, and 1 for any slice that is not `technical` (lens-scan's trust: only
 *  technical findings are ever built by the machine; a product slice tops out at auto-triage); else 3. */
export function ceilingOf(slice: string): number {
  const [category, , riskClass] = slice.split('|');
  return CEILING_1.has(riskClass ?? '-') || category !== 'technical' ? 1 : 3;
}
/** A slice key's start level: technical 2, anything else 0, capped at the ceiling. */
export function startOf(slice: string): number {
  return Math.min(slice.split('|')[0] === 'technical' ? 2 : 0, ceilingOf(slice));
}

export interface TrustSlice {
  slice: string;
  /** The current level, 0..3. */
  level: number;
  /** Where the level comes from: the slice's latest event, or its start level (no event yet). */
  from: 'event' | 'start';
  start: number;
  ceiling: number;
  /** The latest event's figures, when there is one and it carries them. */
  agreement?: number;
  n?: number;
  changedAt?: string;
  reason?: string;
}

/**
 * The slices to show: every slice with an event, and every slice a v5 finding of `proposals` sits in (only those that carry a
 * category: a v4 row has no slice), sorted by level descending, then key. `events` in any order; the latest is the highest id.
 */
export function trustSlices(events: readonly TrustEvent[], proposals: readonly Proposal[] = []): TrustSlice[] {
  const last = new Map<string, TrustEvent>();
  for (const e of events) { const cur = last.get(e.slice); if (!cur || e.id > cur.id) last.set(e.slice, e); }
  const keys = new Set(last.keys());
  for (const p of proposals) if (p.category) keys.add(sliceOf(p));
  const out: TrustSlice[] = [];
  for (const slice of keys) {
    const e = last.get(slice), start = startOf(slice), ceiling = ceilingOf(slice);
    const s: TrustSlice = e ? { slice, level: e.to_level, from: 'event', start, ceiling, changedAt: e.at, reason: e.reason } : { slice, level: start, from: 'start', start, ceiling };
    if (e?.agreement !== undefined) s.agreement = e.agreement;
    if (e?.n !== undefined) s.n = e.n;
    out.push(s);
  }
  return out.sort((a, b) => b.level - a.level || (a.slice < b.slice ? -1 : 1));
}

/** The latest `n` events, newest first. */
export const latestEvents = (events: readonly TrustEvent[], n = 6): TrustEvent[] => [...events].sort((a, b) => b.id - a.id).slice(0, n);

/** Whether a row is a machine decision a person may still veto at `now` (ISO): decided_by `machine:*`, approved or
 *  declined, `veto_until` later than now. */
export function vetoable(p: Pick<Proposal, 'status' | 'decided_by' | 'veto_until'>, now: string): boolean {
  return (p.status === 'approved' || p.status === 'declined') && !!p.decided_by?.startsWith('machine:') && !!p.veto_until && p.veto_until > now;
}
/** Whether a machine recorded the row's decision (decided_by or triaged_by `machine:*`). */
export const machineDecided = (p: Pick<Proposal, 'decided_by' | 'triaged_by'>): boolean =>
  !!p.decided_by?.startsWith('machine:') || !!p.triaged_by?.startsWith('machine:');
