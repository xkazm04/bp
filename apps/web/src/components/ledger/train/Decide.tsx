'use client';
// The one decision control of the release train: Accept, Rework, Descope and Undo for a set of pack items, with the
// note editor the rules ask for (packages/core/src/train/rules.ts noteRequired), the pending state per item until the store's
// change arrives, and a toast naming what was skipped and why. The decision bar and the compare panel's footer both
// render this; nothing else decides. What a decision does (send, ask a note, or refuse with why) is the planner's
// (plan.ts planDecision); runDecision carries the plan out through injected io, so U on an item with nothing to undo
// is a sentence, never a round trip.
//
// useDecide().decide(ids, decision, note?) sends through triageItems (actions.ts: the live route or the Kettle sim).
// A decision that needs a note and has none asks for it instead (LedgerUi.note: the editor opens in the bar, or in the
// compare footer when asked from there). The sent items are pending (LedgerUi.pending) until useTrain() shows them in
// another status: no optimistic flip, the row says "deciding" until the stream says what happened. A single decision on
// the focused (or open) item moves the focus, and the open compare, to the next waiting item of the order DecideOrder
// provides (LedgerPage: the table's visible rows). A decision the store never answers is released after
// PENDING_BOUND_MS with a toast saying it may still have landed (boundPending).
import { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import type { Proposal, ProposalStatus, TriageDecision, TriageResult } from '@bp/core/scan/types';
import { triageItems, refusalText } from '@/lib/scan/actions';
import { WAITING } from '@bp/core/train/rules';
import { parseTriageResult } from '@bp/core/train/wire';
import { useEngine } from '../../hooks';
import { setLedgerUi, settle, useLedgerUi, type LastDecision, type NoteAsk, type SetUi } from '../useLedger';
import { useTrain } from './data';
import { decidable, decisionCounts, planDecision, undoPlan, type PlanData } from './plan';
import { NoteEditor } from './NoteEditor';
import { Btn, type BtnTone } from './ui/Controls';
import './DecisionBar.css';

export interface DecideProps {
  /** The items the controls act on (the selection, else the open item, else the focused one). */
  ids: readonly string[];
  /** A one-line strip (the compare footer) instead of the bar's full set. */
  compact?: boolean;
}

export interface DecideApi {
  /** Apply a decision; a decision that needs a note opens the note editor instead and applies on confirm. `at` says
   *  where that editor shows (the bar, or the compare footer). */
  decide(ids: readonly string[], decision: TriageDecision, note?: string, at?: NoteAsk['at']): Promise<void>;
  /** Items with a decision sent and not yet seen in the store. */
  pending: ReadonlySet<string>;
}

/** How long a sent decision may stay pending with the store silent (a call that hangs, or a write that landed while the
 *  snapshot stream is down). Generous on purpose: dropping it early reopens the double-send the pending set prevents. */
export const PENDING_BOUND_MS = 60_000;

/** After `ms`, release every item still pending at the status it was sent from, and say the decision may have landed.
 *  `later` is the timer (injected so a check can run it at once); an item whose pending moved on is left alone. */
export function boundPending(was: ReadonlyMap<string, ProposalStatus>, ms: number, io: { later(f: () => void, ms: number): unknown; set: SetUi; toast(title: string, body: string): void }): void {
  io.later(() => {
    let expired: string[] = [];
    io.set((u) => {
      expired = [...was].filter(([id, s]) => u.pending.get(id) === s).map(([id]) => id);
      if (!expired.length) return u;
      const m = new Map(u.pending); for (const id of expired) m.delete(id);
      return { ...u, pending: m };
    });
    if (expired.length) io.toast('Still waiting on the store', expired.join(', ') + (expired.length > 1 ? ': those decisions' : ': that decision') + ' may still have landed. Check the row before sending again.');
  }, ms);
}

/** The order "next waiting item" walks after a single decision (the table's visible rows), from LedgerPage. */
export const DecideOrder = createContext<(() => readonly string[]) | null>(null);

// the readings and the verdict live in the planner (plan.ts); kept importable from here for the table's facts and the checks
export { readingsOf, verdictIn, releaseIn, type Readings } from './plan';

const VERB: Record<TriageResult['decision'], string> = { accepted: 'Accepted', rework: 'Sent to rework', descoped: 'Descoped', reopened: 'Back to waiting' };
const REASON: Record<string, string> = {
  'note-required': 'needs a note', 'in-release': 'its release is past draft', 'no-prior-status': 'nothing to undo',
  rebuilt: 'already rebuilt', 'pack-closed': 'its pack is closed', 'not-found': 'not found',
};
/** Each skipped item and why, for the toast: "p-12 (is accepted), p-14 (needs a note)". */
export const skippedText = (s: TriageResult['skipped']): string =>
  s.map((x) => x.id + ' (' + (x.reason ? REASON[x.reason] ?? x.reason : x.status === 'not-found' ? 'not found' : 'is ' + x.status) + ')').join(', ');

/** `own`: the next-waiting order for a caller outside the DecideOrder provider (LedgerPage, which provides it). */
export function useDecide(own?: () => readonly string[]): DecideApi {
  const E = useEngine(), T = useTrain(), ui = useLedgerUi(T.slug ?? 'kettle'), ctx = useContext(DecideOrder), order = own ?? ctx;

  // pending until the item shows another status (or leaves the data): the ledger's one settle rule (intents.ts settle,
  // the same as dispatch's); prunes are idempotent across instances
  useEffect(() => {
    if (!ui.pending.size) return;
    const of = (id: string) => T.byId.get(id)?.status;
    if (settle(ui.pending, of) !== ui.pending) setLedgerUi((u) => { const m = settle(u.pending, of); return m === u.pending ? u : { ...u, pending: m }; });
  }, [T, ui.pending]);
  const pending = useMemo(() => new Set([...ui.pending].filter(([id, s]) => T.byId.get(id)?.status === s).map(([id]) => id)), [T, ui.pending]);

  const decide = useCallback((raw: readonly string[], decision: TriageDecision, note?: string, at: NoteAsk['at'] = 'bar') => runDecision(T, pending, raw, decision, note, at, {
    triage: (ids, d, n) => triageItems(T.ctx, ids, d, n),
    toast: (t, b, _a, _f, tone) => E.toast(t, b, undefined, undefined, tone),
    set: setLedgerUi, later: (f, ms) => setTimeout(f, ms), order: order ?? undefined, last: ui.last,
  }), [E, T, pending, order, ui.last]);

  return { decide, pending };
}

/** What decide() talks to: the triage call, the toasts, the ledger store, the timer and the next-waiting order (all
 *  injected, so a check drives the whole decision path under Node). */
export interface DecideIo {
  triage(ids: string[], decision: TriageDecision, note?: string): Promise<TriageResult>;
  /** Engine.toast's shape: the tone is the fifth argument. */
  toast(title: string, body: string, action?: undefined, fid?: undefined, tone?: 'warn' | 'bad'): void;
  set: SetUi;
  later(f: () => void, ms: number): unknown;
  order?: () => readonly string[];
  /** The last decision (LedgerUi.last): given, a reopen resolves through it (plan.ts undoTargets), so U after the focus
   *  advanced undoes what was just decided; absent, a reopen acts on what was asked. */
  last?: LastDecision | null;
}

/** The decision path: the planner says what the decision does (planDecision), this carries it out. Only a `send`
 *  reaches the store; every other plan is a sentence and no call (U on a waiting item, Undo on a rebuilt one). */
export async function runDecision(T: PlanData, pending: ReadonlySet<string>, raw: readonly string[], decision: TriageDecision, note: string | undefined, at: NoteAsk['at'], io: DecideIo): Promise<void> {
  // Undo reverses what the person said, not where the focus went after it
  if (decision === 'reopen' && io.last !== undefined) raw = undoPlan(T, io.last, raw).ids;
  const plan = planDecision(T, raw, decision, note === undefined ? { pending } : { pending, note });
  switch (plan.kind) {
    case 'empty': case 'pending': io.toast('Nothing to decide', plan.why, undefined, undefined, 'warn'); return;
    case 'over-cap': io.toast('Too many items', plan.why + ': select fewer', undefined, undefined, 'warn'); return;
    case 'none-can': io.toast(WORD[decision] + ' does not apply', plan.why, undefined, undefined, 'warn'); return;
    case 'ask-note': { const { ids, decision: d } = plan; io.set((u) => ({ ...u, note: { ids, decision: d, at } })); return; }
    case 'send': break;
  }
  const ids = plan.ids;
  const was = new Map(ids.map((id) => [id, T.byId.get(id)!.status]));
  io.set((u) => { const m = new Map(u.pending); for (const [id, s] of was) m.set(id, s); return { ...u, pending: m, note: null }; });
  boundPending(was, PENDING_BOUND_MS, { later: io.later, set: io.set, toast: (t, b) => io.toast(t, b, undefined, undefined, 'warn') });
  const drop = (xs: readonly string[]) => io.set((u) => { const m = new Map(u.pending); for (const id of xs) m.delete(id); return { ...u, pending: m }; });
  try {
    const r = await io.triage(ids, decision, note);
    if (r.skipped.length) drop(r.skipped.map((s) => s.id));
    io.toast(VERB[r.decision] + ' ' + r.triaged.length, r.skipped.length ? 'skipped ' + r.skipped.length + ': ' + skippedText(r.skipped) : r.triaged.join(', '));
    const moved = new Set(r.triaged), one = ids.length === 1 && moved.has(ids[0]) ? ids[0] : null;
    // keep moving (A/1): after deciding the focused item, focus the next one that waits; the open compare follows
    const ord = one && decision !== 'reopen' ? io.order?.() ?? [] : [];
    const i = one ? ord.indexOf(one) : -1;
    const next = i < 0 ? undefined : ord.slice(i + 1).find((id) => WAITING.has(T.byId.get(id)?.status ?? 'proposed'));
    io.set((u) => {
      let n = u;
      // the last decision is what moved (one step deep: a reopen that lands takes its items off it)
      if (r.triaged.length) {
        const left = u.last && r.decision === 'reopened' ? u.last.ids.filter((id) => !moved.has(id)) : [];
        const last: LastDecision | null = r.decision !== 'reopened' ? { ids: r.triaged, decision: r.decision } : u.last && left.length ? { ...u.last, ids: left } : null;
        n = { ...n, last };
      }
      if (decision !== 'reopen' && [...u.sel].some((id) => moved.has(id))) { const s = new Set(u.sel); for (const id of moved) s.delete(id); n = { ...n, sel: s }; }
      if (next && one && (u.focus === one || u.open === one)) n = { ...n, focus: next, open: u.open === one ? next : u.open };
      return n;
    });
  } catch (e) {
    drop(ids);
    const err = e as { status?: number; body?: unknown };
    const body = err.status === 409 ? parseTriageResult(err.body) : null;
    if (body?.ok) io.toast('Nothing moved', skippedText(body.value.skipped), undefined, undefined, 'warn');
    else io.toast(err.status === 409 || err.status === 400 ? 'Refused' : 'Triage failed', refusalText(e), undefined, undefined, 'bad');
  }
}

const WORD: Record<TriageDecision, string> = { accept: 'Accept', rework: 'Rework', descope: 'Descope', reopen: 'Undo' };

/** The decision buttons: the bar's full set (Undo, Accept n, Rework, Descope, each with its key), or the compare
 *  footer's one-line strip (compact: the footer shows the state, and Undo only while there is a decision to undo, as
 *  A/1). The note editor replaces them while asked. */
export function Decide({ ids, compact = false }: DecideProps) {
  const T = useTrain(), ui = useLedgerUi(T.slug ?? 'kettle'), { decide, pending } = useDecide();
  const ps = useMemo(() => ids.map((id) => T.byId.get(id)).filter((p): p is Proposal => !!p), [ids, T]);
  const n = useMemo(() => decisionCounts(T, ids), [T, ids]);
  // Undo names the decision it reverses when that is the last one, not the targets (plan.ts undoPlan)
  const undo = useMemo(() => undoPlan(T, ui.last, ids), [T, ui.last, ids]);
  const at: NoteAsk['at'] = compact ? 'compare' : 'bar', ask = ui.note && ui.note.at === at ? ui.note : null;
  if (ask) {
    const asked = ask.ids.map((id) => T.byId.get(id)).filter((p): p is Proposal => !!p);
    const { can, flagged } = decidable(T, asked, ask.decision);
    return <NoteEditor ask={ask} can={can.length} flagged={flagged} compact={compact} onSend={(note) => void decide(ask.ids, ask.decision, note, ask.at)} />;
  }
  const btn = (d: TriageDecision, tone: BtnTone | undefined, label: string, key: string, role?: string) => {
    const why = d === 'reopen' ? undo.why : n.why[d];
    return (
      <Btn tone={tone} kbd={key} reason={why ?? undefined} title={label + ' (' + key + ')'} role={role} onClick={() => void decide(ps.map((p) => p.id), d, undefined, at)}>
        {label}
      </Btn>
    );
  };
  // the compare footer shows the item's state itself; the strip marks only a decision on its way
  const busy = compact && ps.some((p) => pending.has(p.id));
  // the Accept count is what Accept would move, not what is selected
  const nAcc = n.accept;
  return (
    <span className={'tr-decide' + (compact ? ' compact' : '')} role="group" aria-label="Decide" aria-busy={busy || undefined}>
      {compact && undo.why ? null : btn('reopen', undefined, undo.label, 'U')}
      {btn('accept', 'acc', '✓ Accept' + (!compact && nAcc ? ' ' + nAcc : ''), 'A', compact ? undefined : 'tr-btn-accept')}
      {btn('rework', 'rw', '↺ Rework', 'R')}
      {btn('descope', 'ds', '⊘ Descope', 'S')}
    </span>
  );
}
