'use client';
// The one decision control of the release train: Accept, Rework, Descope and Undo for a set of pack items, with the
// note editor the rules ask for (src/lib/train/rules.ts noteRequired), the pending state per item until the store's
// change arrives, and a toast naming what was skipped and why. The decision bar and the compare panel's footer both
// render this; nothing else decides.
//
// useDecide().decide(ids, decision, note?) sends through triageItems (actions.ts: the live route or the Kettle sim).
// A decision that needs a note and has none asks for it instead (LedgerUi.note: the editor opens in the bar, or in the
// compare footer when asked from there). The sent items are pending (LedgerUi.pending) until useTrain() shows them in
// another status: no optimistic flip, the row says "deciding" until the stream says what happened. A single decision on
// the focused (or open) item moves the focus, and the open compare, to the next waiting item of the order DecideOrder
// provides (LedgerPage: the table's visible rows).
import { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import type { Proposal, Release, TriageDecision, TriageResult } from '@/lib/scan/types';
import { triageItems, refusalText } from '@/lib/scan/actions';
import { verdictOf, type Verdict } from '@/lib/scan/compare';
import { TRIAGE_FROM, WAITING, canDecide, isFlagged, noteRequired } from '@/lib/train/rules';
import { parseTriageResult } from '@/lib/train/wire';
import { useEngine } from '../../hooks';
import { setLedgerUi, useLedgerUi, type NoteAsk } from '../useLedger';
import { useTrain, type TrainData } from './data';
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

/** The order "next waiting item" walks after a single decision (the table's visible rows), from LedgerPage. */
export const DecideOrder = createContext<(() => readonly string[]) | null>(null);

/** An item's verdict, from its own readings (only the items being decided: a click, not a render). */
export function verdictIn(T: TrainData, p: Proposal): Verdict {
  const before = T.measurements.filter((m) => m.proposal_id === p.id && m.phase === 'before');
  const after = T.measurements.filter((m) => m.proposal_id === p.id && m.phase === 'after');
  return verdictOf(p, before, after, T.lenses).verdict;
}
export const releaseIn = (T: TrainData, p: Proposal): Release | undefined => (p.release_id ? T.releases.find((r) => r.id === p.release_id) : undefined);

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

  // pending until the item shows another status (or leaves the data); prunes are idempotent across instances
  useEffect(() => {
    if (!ui.pending.size) return;
    const gone = [...ui.pending].filter(([id, s]) => T.byId.get(id)?.status !== s).map(([id]) => id);
    if (gone.length) setLedgerUi((u) => { const m = new Map(u.pending); for (const id of gone) m.delete(id); return m.size === u.pending.size ? u : { ...u, pending: m }; });
  }, [T, ui.pending]);
  const pending = useMemo(() => new Set([...ui.pending].filter(([id, s]) => T.byId.get(id)?.status === s).map(([id]) => id)), [T, ui.pending]);

  const decide = useCallback(async (raw: readonly string[], decision: TriageDecision, note?: string, at: NoteAsk['at'] = 'bar') => {
    const ids = [...new Set(raw)].filter((id) => T.byId.has(id) && !pending.has(id));
    if (!ids.length) { E.toast('Nothing to decide', raw.length ? 'a decision on these is on its way' : 'focus or select a pack item first'); return; }
    const can = ids.map((id) => T.byId.get(id)!).filter((p) => canDecide(decision, p, releaseIn(T, p)));
    if (decision !== 'reopen' && note === undefined && can.some((p) => noteRequired(decision, p, verdictIn(T, p)))) {
      setLedgerUi((u) => ({ ...u, note: { ids, decision, at } }));
      return;
    }
    const was = new Map(ids.map((id) => [id, T.byId.get(id)!.status]));
    setLedgerUi((u) => { const m = new Map(u.pending); for (const [id, s] of was) m.set(id, s); return { ...u, pending: m, note: null }; });
    const drop = (xs: readonly string[]) => setLedgerUi((u) => { const m = new Map(u.pending); for (const id of xs) m.delete(id); return { ...u, pending: m }; });
    try {
      const r = await triageItems(T.ctx, ids, decision, note);
      if (r.skipped.length) drop(r.skipped.map((s) => s.id));
      E.toast(VERB[r.decision] + ' ' + r.triaged.length, r.skipped.length ? 'skipped ' + r.skipped.length + ': ' + skippedText(r.skipped) : r.triaged.join(', '));
      const moved = new Set(r.triaged), one = ids.length === 1 && moved.has(ids[0]) ? ids[0] : null;
      // keep moving (A/1): after deciding the focused item, focus the next one that waits; the open compare follows
      const ord = one && decision !== 'reopen' ? order?.() ?? [] : [];
      const i = one ? ord.indexOf(one) : -1;
      const next = i < 0 ? undefined : ord.slice(i + 1).find((id) => WAITING.has(T.byId.get(id)?.status ?? 'proposed'));
      setLedgerUi((u) => {
        let n = u;
        if (decision !== 'reopen' && [...u.sel].some((id) => moved.has(id))) { const s = new Set(u.sel); for (const id of moved) s.delete(id); n = { ...n, sel: s }; }
        if (next && one && (u.focus === one || u.open === one)) n = { ...n, focus: next, open: u.open === one ? next : u.open };
        return n;
      });
    } catch (e) {
      drop(ids);
      const err = e as { status?: number; body?: unknown };
      const body = err.status === 409 ? parseTriageResult(err.body) : null;
      if (body?.ok) E.toast('Nothing moved', skippedText(body.value.skipped));
      else E.toast(err.status === 409 || err.status === 400 ? 'Refused' : 'Triage failed', refusalText(e));
    }
  }, [E, T, pending, order]);

  return { decide, pending };
}

/** Why a decision cannot apply to any of the items (the disabled button's tooltip), or null when it can to some. */
function whyNot(T: TrainData, ps: readonly Proposal[], d: TriageDecision): string | null {
  if (!ps.length) return 'Focus or select a pack item first';
  if (ps.some((p) => canDecide(d, p, releaseIn(T, p)))) return null;
  if (d === 'reopen') return 'Nothing to undo: only accepted, rework or descoped items go back, until their release is built';
  return (d === 'accept' ? 'Accept' : d === 'rework' ? 'Rework' : 'Descope') + ' takes ' + TRIAGE_FROM[d].join(', ') + ' items' + (d === 'accept' ? '' : ' not in a release past draft');
}

/** The decision buttons: the bar's full set (Undo, Accept n, Rework, Descope, each with its key), or the compare
 *  footer's one-line strip (compact: the footer shows the state, and Undo only while there is a decision to undo, as
 *  A/1). The note editor replaces them while asked. */
export function Decide({ ids, compact = false }: DecideProps) {
  const T = useTrain(), ui = useLedgerUi(T.slug ?? 'kettle'), { decide, pending } = useDecide();
  const ps = useMemo(() => ids.map((id) => T.byId.get(id)).filter((p): p is Proposal => !!p), [ids, T]);
  const at: NoteAsk['at'] = compact ? 'compare' : 'bar', ask = ui.note && ui.note.at === at ? ui.note : null;
  if (ask) {
    const flagged = ask.ids.map((id) => T.byId.get(id)).filter((p): p is Proposal => !!p && isFlagged(p, verdictIn(T, p))).length;
    return <NoteEditor ask={ask} flagged={flagged} compact={compact} onSend={(note) => void decide(ask.ids, ask.decision, note, ask.at)} />;
  }
  const btn = (d: TriageDecision, tone: BtnTone | undefined, label: string, key: string, role?: string) => {
    const why = whyNot(T, ps, d);
    return (
      <Btn tone={tone} kbd={key} disabled={!!why} title={why ?? label + ' (' + key + ')'} role={role} onClick={() => void decide(ps.map((p) => p.id), d, undefined, at)}>
        {label}
      </Btn>
    );
  };
  // the compare footer shows the item's state itself; the strip marks only a decision on its way
  const busy = compact && ps.some((p) => pending.has(p.id));
  return (
    <span className={'tr-decide' + (compact ? ' compact' : '')} role="group" aria-label="Decide" aria-busy={busy || undefined}>
      {compact && whyNot(T, ps, 'reopen') ? null : btn('reopen', undefined, 'Undo', 'U')}
      {btn('accept', 'acc', '✓ Accept' + (!compact && ps.length ? ' ' + ps.length : ''), 'A', compact ? undefined : 'tr-btn-accept')}
      {btn('rework', 'rw', '↺ Rework', 'R')}
      {btn('descope', 'ds', '⊘ Descope', 'S')}
    </span>
  );
}
