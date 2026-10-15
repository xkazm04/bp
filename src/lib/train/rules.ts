// The release train's triage rules, in one place for every surface (the ledger's table, the compare panel, the
// decision bar, the phone cards). store.mjs owns the transitions and enforces its own subset (a failed item needs a
// note to be accepted; nothing leaves a release that is no longer a draft); these tables only decide what the UI
// offers and asks for, so a refused move is rare and always explained. Pure, type-only imports: Node checks import it.
import type { Proposal, ProposalStatus, Release, TriageDecision } from '../scan/types.ts';
import type { Verdict } from '../scan/compare.ts';

/** Built and measured, waiting for a person: what the triage scope lists first and what "waiting for you" counts. */
export const WAITING: ReadonlySet<ProposalStatus> = new Set<ProposalStatus>(['done', 'failed']);
/** A person's triage outcome: what `reopen` takes back. */
export const TRIAGED: ReadonlySet<ProposalStatus> = new Set<ProposalStatus>(['accepted', 'rework', 'descoped']);

export const isWaiting = (p: Pick<Proposal, 'status'>): boolean => WAITING.has(p.status);
export const isTriaged = (p: Pick<Proposal, 'status'>): boolean => TRIAGED.has(p.status);

/** The statuses each decision may start from (store.mjs TRIAGE, plus v3 reopen). */
export const TRIAGE_FROM: Readonly<Record<TriageDecision, readonly ProposalStatus[]>> = {
  accept: ['done', 'failed'],
  rework: ['done', 'failed', 'accepted'],
  descope: ['done', 'failed', 'accepted', 'rework', 'proposed', 'approved'],
  reopen: ['accepted', 'rework', 'descoped'],
};

/** Accepting this item ships something that did not prove itself: it failed, or its metric did not move. */
export const isFlagged = (p: Pick<Proposal, 'status'>, verdict: Verdict): boolean => p.status === 'failed' || verdict !== 'moved';

/** Whether the decision needs a note: rework (the note is the next attempt's brief), descope (why it was dropped), and
 *  accepting a flagged item (why it ships anyway). Reopen never does. */
export function noteRequired(d: TriageDecision, p: Pick<Proposal, 'status'>, verdict: Verdict): boolean {
  if (d === 'rework' || d === 'descope') return true;
  return d === 'accept' && isFlagged(p, verdict);
}

/** Whether the decision may apply to the item now: its status is one the decision starts from, and leaving a release
 *  (rework, descope or reopen of an item in one) is allowed only while that release is a draft. */
export function canDecide(d: TriageDecision, p: Pick<Proposal, 'status' | 'release_id'>, release?: Pick<Release, 'status'>): boolean {
  if (!TRIAGE_FROM[d].includes(p.status)) return false;
  if (d !== 'accept' && p.release_id !== undefined && release !== undefined && release.status !== 'draft') return false;
  return true;
}
