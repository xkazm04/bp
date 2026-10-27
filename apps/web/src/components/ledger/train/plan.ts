// The release train's one decision planner: what a triage decision on a set of pack items DOES, before anything is
// sent. Every surface reads it - decide() (the buttons and the A/R/S/U keys, Decide.tsx), the decision bar's counts
// (DecisionBar.tsx), the note editor's counts and the Release tab's Undo (release/Package.tsx) - so the button, the
// key, the count and the refusal cannot disagree. Pure, no React: Node checks import it (scripts/check-train-plan.ts).
//
// The single-item rules are packages/core/src/train/rules.ts (canDecide, noteRequired, isFlagged); this module owns the
// composites rules.ts cannot see: items with a decision on its way (pending), the triage cap, and the `rebuilt`
// refusal (another proposal is the item's next attempt, `attempt_of`: undo that one instead; the store's reason
// `rebuilt`). It never branches on a lens id.
import type { Measurement, Proposal, Release, TriageDecision } from '@bp/core/scan/types';
import { triageCapText } from '@bp/core/scan/types';
import { verdictOf, type Verdict } from '@bp/core/scan/compare';
import { TRIAGE_FROM, canDecide, isFlagged, noteRequired } from '@bp/core/train/rules';
import type { TrainData } from './data';
import type { LastDecision } from '../useLedger';

/** What the planner reads of the train data. */
export type PlanData = Pick<TrainData, 'proposals' | 'byId' | 'releases' | 'measurements' | 'lenses'>;

/** Every item's before and after readings, grouped in one pass and kept per measurements array (the store hands the same
 *  array until it changes): the one source of an item's readings for the table's facts (ItemRow.tsx useItemFacts), the
 *  decision bar and the decision path. */
export interface Readings { before: Measurement[]; after: Measurement[] }
const READINGS = new WeakMap<readonly Measurement[], ReadonlyMap<string, Readings>>();
export function readingsOf(ms: readonly Measurement[]): ReadonlyMap<string, Readings> {
  let out = READINGS.get(ms);
  if (out) return out;
  const by = new Map<string, Readings>();
  for (const m of ms) {
    if (!m.proposal_id || (m.phase !== 'before' && m.phase !== 'after')) continue;
    let e = by.get(m.proposal_id);
    if (!e) by.set(m.proposal_id, (e = { before: [], after: [] }));
    e[m.phase].push(m);
  }
  READINGS.set(ms, out = by);
  return out;
}
const NO_READINGS: readonly Measurement[] = [];

/** An item's verdict, from its own readings (a lookup in the grouped readings, not a scan of every measurement). */
export function verdictIn(T: Pick<PlanData, 'measurements' | 'lenses'>, p: Proposal): Verdict {
  const e = readingsOf(T.measurements).get(p.id);
  return verdictOf(p, e?.before ?? NO_READINGS, e?.after ?? NO_READINGS, T.lenses).verdict;
}
export const releaseIn = (T: Pick<PlanData, 'releases'>, p: Proposal): Release | undefined => (p.release_id ? T.releases.find((r) => r.id === p.release_id) : undefined);

/** Which proposal rebuilt each item (its `attempt_of`), kept per proposals array. */
const REBUILT = new WeakMap<readonly Proposal[], ReadonlyMap<string, string>>();
export function rebuiltBy(ps: readonly Proposal[]): ReadonlyMap<string, string> {
  let out = REBUILT.get(ps);
  if (out) return out;
  const m = new Map<string, string>();
  for (const p of ps) if (p.attempt_of) m.set(p.attempt_of, p.id);
  REBUILT.set(ps, out = m);
  return out;
}

const WORD: Record<TriageDecision, string> = { accept: 'Accept', rework: 'Rework', descope: 'Descope', reopen: 'Undo' };
export const EMPTY_WHY = 'Focus or select a pack item first';
export const PENDING_WHY = 'A decision on these is on its way';
export const LOCKED_WHY = 'Locked: the release left draft';
const statusWhy = (d: TriageDecision): string => d === 'reopen'
  ? 'Nothing to undo: only accepted, rework or descoped items go back, until their release is built'
  : WORD[d] + ' takes ' + TRIAGE_FROM[d].join(', ') + ' items' + (d === 'accept' ? '' : ' not in a release past draft');

/** Why the decision cannot apply to this one item, or null when it can. */
export function refusalOf(T: PlanData, p: Proposal, d: TriageDecision): string | null {
  const rel = releaseIn(T, p);
  if (canDecide(d, p, rel)) {
    const by = d === 'reopen' ? rebuiltBy(T.proposals).get(p.id) : undefined;
    return by ? 'Rebuilt as ' + by + ': undo that one instead' : null;
  }
  return TRIAGE_FROM[d].includes(p.status) ? LOCKED_WHY : statusWhy(d);
}

/** The items a decision can actually move now, and how many of those are flagged (accepting them ships ⚑). EVERY
 *  count a surface shows is of these, not of the selection: a selection of five holding two already-accepted items
 *  accepts three, and says three. */
export function decidable(T: PlanData, ps: readonly Proposal[], d: TriageDecision): { can: Proposal[]; flagged: number } {
  const can = ps.filter((p) => refusalOf(T, p, d) === null);
  return { can, flagged: can.filter((p) => isFlagged(p, verdictIn(T, p))).length };
}

/** Why a decision cannot apply to any of the items (one reason when they share it), or null when it can to some. */
function whyNone(T: PlanData, ps: readonly Proposal[], d: TriageDecision): string | null {
  if (!ps.length) return EMPTY_WHY;
  const why = new Set<string>();
  for (const p of ps) { const w = refusalOf(T, p, d); if (w === null) return null; why.add(w); }
  return why.size === 1 ? [...why][0] : statusWhy(d);
}

export type Plan =
  | { kind: 'empty' | 'pending' | 'over-cap' | 'none-can'; why: string }
  /** a note is required first: `can` items would move, `flagged` of them ship flagged */
  | { kind: 'ask-note'; ids: string[]; decision: Exclude<TriageDecision, 'reopen'>; can: number; flagged: number }
  | { kind: 'send'; ids: string[] };

export interface PlanOpts { pending?: ReadonlySet<string>; note?: string }

/** What a decision on `raw` does now: nothing to act on, all on their way, past the cap, applies to none (with why),
 *  asks a note first, or sends these ids (the known, not-pending ones; the store answers for the rest). */
export function planDecision(T: PlanData, raw: readonly string[], d: TriageDecision, o: PlanOpts = {}): Plan {
  const known = [...new Set(raw)].filter((id) => T.byId.has(id));
  const ids = o.pending ? known.filter((id) => !o.pending!.has(id)) : known;
  if (!ids.length) return known.length ? { kind: 'pending', why: PENDING_WHY } : { kind: 'empty', why: EMPTY_WHY };
  const over = triageCapText(ids.length); // the route refuses a body past the cap; say so before sending one
  if (over) return { kind: 'over-cap', why: over };
  const ps = ids.map((id) => T.byId.get(id)!);
  const why = whyNone(T, ps, d);
  if (why !== null) return { kind: 'none-can', why };
  if (d !== 'reopen' && o.note === undefined) {
    const { can, flagged } = decidable(T, ps, d);
    if (can.some((p) => noteRequired(d, p, verdictIn(T, p)))) return { kind: 'ask-note', ids, decision: d, can: can.length, flagged };
  }
  return { kind: 'send', ids };
}

export interface DecisionCounts {
  /** What Accept would move. */
  accept: number;
  /** Of those, the ones that need a note (failed, flat or unmeasured). */
  flagged: number;
  /** Items in a release past draft (they cannot be reworked, descoped or undone). */
  locked: number;
  /** Each decision's why-not over the targets, null when it applies to some. */
  why: Record<TriageDecision, string | null>;
}

/** The decision bar's numbers and every button's why-not, over the targets. */
export function decisionCounts(T: PlanData, targets: readonly string[]): DecisionCounts {
  const ps = targets.map((id) => T.byId.get(id)).filter((p): p is Proposal => !!p);
  const acc = decidable(T, ps, 'accept');
  const locked = ps.filter((p) => { const r = releaseIn(T, p); return !!r && r.status !== 'draft'; }).length;
  const why = { accept: whyNone(T, ps, 'accept'), rework: whyNone(T, ps, 'rework'), descope: whyNone(T, ps, 'descope'), reopen: whyNone(T, ps, 'reopen') };
  return { accept: acc.can.length, flagged: acc.flagged, locked, why };
}

const UNDO_WORD: Record<LastDecision['decision'], string> = { accepted: 'accept', rework: 'rework', descoped: 'descope' };

/** What Undo (the button and U) reverses: the explicit targets when any of them can be undone (the person moved back
 *  onto a decided item), else the last decision's items that still can (`last`: LedgerUi.last, the store's `triaged`),
 *  else none. Undo follows what the person said, not where the focus advanced to after it. */
export function undoTargets(T: PlanData, last: LastDecision | null | undefined, targets: readonly string[]): string[] {
  const can = (ids: readonly string[]) => ids.filter((id) => { const p = T.byId.get(id); return !!p && refusalOf(T, p, 'reopen') === null; });
  const own = can(targets);
  if (own.length) return [...targets];
  return last ? can(last.ids) : [];
}

/** The Undo control over the targets: the ids a reopen is planned over (the resolved undo targets, else what was asked,
 *  so a refusal says why in the planner's words), its why-not, and its label ("Undo accept · p-12" while it reverses
 *  the last decision rather than the targets). */
export function undoPlan(T: PlanData, last: LastDecision | null | undefined, targets: readonly string[]): { ids: string[]; why: string | null; label: string } {
  const ids = undoTargets(T, last, targets);
  if (ids.length) {
    const viaLast = !!last && ids.every((id) => last.ids.includes(id)) && !targets.some((id) => ids.includes(id));
    const label = viaLast ? 'Undo ' + UNDO_WORD[last.decision] + ' · ' + (ids.length === 1 ? ids[0] : ids.length + ' items') : 'Undo';
    return { ids, why: null, label };
  }
  const asked = last ? [...last.ids] : [...targets];
  const ps = asked.map((id) => T.byId.get(id)).filter((p): p is Proposal => !!p);
  return { ids: asked, why: whyNone(T, ps, 'reopen') ?? EMPTY_WHY, label: 'Undo' };
}
