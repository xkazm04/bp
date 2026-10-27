// The ledger's one in-flight rule: "this finding was sent from status S; show it as moving until the store says
// otherwise". Dispatch and wave dispatch (useLedger.ts, `LedgerUi.intents`) and triage (train/Decide.tsx,
// `LedgerUi.pending`) hold it in the LedgerUi module store, so it survives the ledger closing, and settle it by the
// authority: an entry ends when the store shows the row in another status (or the row is gone), never because something
// else changed. A failed send withdraws only its own entries still at their sent-from status (compare-and-swap), and an
// entry the store never answers is released after the bound (the caller says it may still have landed).
// React-free and pure: scripts/check-ledger-intents.ts drives it under Node.
import type { ProposalStatus } from '@bp/core/scan/types';

/** One finding on its way: the status it was sent from, what it shows meanwhile (absent: its own status), the send
 *  that painted it, and when. */
export interface Intent { readonly from: ProposalStatus; readonly shows?: ProposalStatus; readonly attempt: number; readonly at: number }
export type Intents = ReadonlyMap<string, Intent>;
/** The store's status of a finding; undefined for one the store does not have. */
export type StatusOf = (id: string) => ProposalStatus | undefined;

/** How long an intent may stand with the store silent (the same generosity as triage's PENDING_BOUND_MS). */
export const INTENT_BOUND_MS = 60_000;

let seq = 0;
/** A fresh attempt number for one send. */
export const nextAttempt = (): number => ++seq;

/** `intents` with each of `ids` the store has painted as sent from its current status by `attempt`. */
export function paint(intents: Intents, ids: Iterable<string>, statusOf: StatusOf, o: { attempt: number; at: number; shows?: ProposalStatus }): Intents {
  const m = new Map(intents);
  for (const id of ids) {
    const from = statusOf(id);
    if (from !== undefined) m.set(id, o.shows === undefined ? { from, attempt: o.attempt, at: o.at } : { from, shows: o.shows, attempt: o.attempt, at: o.at });
  }
  return m;
}

const fromOf = (v: Intent | ProposalStatus): ProposalStatus => (typeof v === 'string' ? v : v.from);
/** Whether an entry sent from `from` still stands while the store shows `now`. */
export const holds = (from: ProposalStatus, now: ProposalStatus | undefined): boolean => now === from;

/** Drop every entry the store has answered (another status, or the row gone). The same map when none is. Takes an
 *  intent map or triage's id -> sent-from status map. */
export function settle<V extends Intent | ProposalStatus>(m: ReadonlyMap<string, V>, statusOf: StatusOf): ReadonlyMap<string, V> {
  let out: Map<string, V> | null = null;
  for (const [id, v] of m) if (!holds(fromOf(v), statusOf(id))) (out ??= new Map(m)).delete(id);
  return out ?? m;
}

/** Withdraw `attempt`'s entries (only `ids`, when given) that are still at their sent-from status; another attempt's
 *  entries and the ones the store already moved stay. The same map when none goes. */
export function revert(intents: Intents, attempt: number, statusOf: StatusOf, ids?: Iterable<string>): Intents {
  const only = ids ? new Set(ids) : null;
  let out: Map<string, Intent> | null = null;
  for (const [id, it] of intents) if (it.attempt === attempt && (!only || only.has(id)) && holds(it.from, statusOf(id))) (out ??= new Map(intents)).delete(id);
  return out ?? intents;
}

/** Release every entry painted `bound` or more before `now`; `expired` names them (for the "may still have landed" toast). */
export function expire(intents: Intents, now: number, bound: number): { intents: Intents; expired: string[] } {
  const expired = [...intents].filter(([, it]) => now - it.at >= bound).map(([id]) => id);
  if (!expired.length) return { intents, expired };
  const m = new Map(intents); for (const id of expired) m.delete(id);
  return { intents: m, expired };
}

/** Whether the finding is in flight: it has an intent and the store still shows the status it was sent from. */
export const inFlight = (status: ProposalStatus, it: Intent | undefined): boolean => !!it && holds(it.from, status);
/** The status to show: the intent's while in flight, else the store's. */
export const overlay = (status: ProposalStatus, it: Intent | undefined): ProposalStatus => (it && holds(it.from, status) ? it.shows ?? status : status);
