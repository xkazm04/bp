'use client';
// One built item of a pack in the triage table (contest A/1's `.lg-tr` row): checkbox, lens, feature with the item id
// (and its attempt), title with the triage note, before -> after with the metric key, the verdict, evidence icons
// (screens, a perf item's runs, the commit) and the state. The focused row (J/K) wears a ring, the open row (in the
// compare panel) a stronger tint, the selected row the accent bar: three looks, so they are never confused. A click
// opens the item in the compare panel; the checkbox selects. Memoised by id: its props are the proposal row (kept by
// identity until it changes) and the item's facts (useItemFacts keeps an unchanged item's facts object).
//
// useItemFacts: what the table, the decision bar and the matrix need of every pack item, from useTrain() in one pass
// over the measurements and shots: the verdict (compare.ts verdictOf, noise-aware), before/after, screens, runs and
// the attempt chain.
import { memo, useMemo, useRef } from 'react';
import type { Measurement, Proposal } from '@/lib/scan/types';
import { runStats, verdictOf, type Verdict } from '@/lib/scan/compare';
import { isFlagged } from '@/lib/train/rules';
import { useTrain } from './data';
import { LensTag, MetricMove, StateMark, VerdictChip } from './ui/Marks.tsx';

/** What a pack item's row and the decisions need to know about it. */
export interface ItemFacts {
  verdict: Verdict;
  /** The before reading (the baseline runs' median when there are several) and the latest after, of its own metric. */
  before?: number;
  after?: number;
  unit?: string;
  /** Screens captured for it (each phase of each theme and size). */
  shots: number;
  /** Baseline runs of its metric (more than one: a performance probe) and after readings. */
  runs: number;
  afters: number;
  /** 1 for a first build; a rework rebuild counts its chain of `attempt_of`. */
  attempt: number;
  /** The previous attempt and the note it was sent back with. */
  prev?: string;
  prevNote?: string;
  /** Its build failed (status failed, or accepted from failed). */
  failed: boolean;
  /** Accepted although it failed or its metric did not move (⚑). */
  flagged: boolean;
}

const same = (a: ItemFacts, b: ItemFacts) => (Object.keys(a) as (keyof ItemFacts)[]).every((k) => a[k] === b[k]) && Object.keys(a).length === Object.keys(b).length;

/** Facts of every pack item, by id. An item whose facts did not change keeps its object, so its row skips the render. */
export function useItemFacts(): ReadonlyMap<string, ItemFacts> {
  const T = useTrain(), prev = useRef<ReadonlyMap<string, ItemFacts>>(new Map());
  return useMemo(() => {
    const ev = new Map<string, { before: Measurement[]; after: Measurement[]; shots: Set<string> }>();
    const of = (id: string) => { let e = ev.get(id); if (!e) ev.set(id, (e = { before: [], after: [], shots: new Set() })); return e; };
    for (const m of T.measurements) if (m.proposal_id && m.phase) of(m.proposal_id)[m.phase].push(m);
    for (const s of T.shots) if (s.proposal_id && s.phase) of(s.proposal_id).shots.add(s.phase + '\u0000' + (s.theme ?? '') + '\u0000' + (s.size ?? ''));
    const out = new Map<string, ItemFacts>(), old = prev.current;
    for (const p of T.proposals) {
      if (!p.pack_id) continue;
      const e = ev.get(p.id), v = verdictOf(p, e?.before ?? [], e?.after ?? [], T.lenses);
      const base = (e?.before ?? []).filter((m) => m.lens === p.lens && m.metric === p.metric);
      const f: ItemFacts = { verdict: v.verdict, shots: e?.shots.size ?? 0, runs: base.length, afters: (e?.after ?? []).filter((m) => m.lens === p.lens && m.metric === p.metric).length, attempt: 1, failed: false, flagged: false };
      const before = base.length > 1 ? runStats(base.map((m) => m.value), v.from?.unit).median : v.from?.value;
      if (before !== undefined) f.before = before;
      if (v.to) f.after = v.to.value;
      const unit = v.from?.unit ?? v.to?.unit;
      if (unit) f.unit = unit;
      let a: Proposal | undefined = p;
      while (a?.attempt_of && f.attempt < 50) { f.attempt++; a = T.byId.get(a.attempt_of); }
      if (p.attempt_of) { f.prev = p.attempt_of; const n = T.byId.get(p.attempt_of)?.triage_note; if (n) f.prevNote = n; }
      // the status before the triage tells a failed build once it is accepted
      const was = p.status === 'accepted' ? p.triaged_from ?? p.status : p.status;
      f.failed = was === 'failed';
      f.flagged = p.status === 'accepted' && isFlagged({ status: was }, v.verdict);
      const o = old.get(p.id);
      out.set(p.id, o && same(o, f) ? o : f);
    }
    prev.current = out;
    return out;
  }, [T]);
}

export interface ItemRowProps {
  p: Proposal;
  /** The feature's name in the map. */
  fname: string;
  facts: ItemFacts | undefined;
  sel: boolean;
  /** The keyboard focus (J/K): the ring, and the row Tab lands on. */
  focus: boolean;
  /** Shown in the compare panel. */
  open: boolean;
  pending: boolean;
  onToggle(id: string): void;
  onFocus(id: string): void;
  onOpen(id: string): void;
}

/** Evidence at a glance: screens (or a perf item's runs) and the commit; a missing one is dimmed and says why. */
function Evidence({ p, x }: { p: Proposal; x: ItemFacts | undefined }) {
  const shots = x?.shots ?? 0, runs = x?.runs ?? 0;
  return (
    <span className="tr-ev">
      {runs > 1
        ? <span title={runs + ' baseline runs and ' + (x?.afters ?? 0) + ' after'}>⧗ runs {runs}+{x?.afters ?? 0}</span>
        : <span className={shots ? undefined : 'no'} title={shots ? shots + ' screens (before and after)' : 'no screens: the harness cannot render this feature'}>▣ {shots || '–'}</span>}
      <span className={p.commit_sha ? undefined : 'no'} title={p.commit_sha ? '1 commit, ' + p.commit_sha.slice(0, 7) + ': its diff is in the compare panel' : 'no commit'}>± {p.commit_sha ? 1 : '–'}</span>
    </span>
  );
}

export const ItemRow = memo(function ItemRow({ p, fname, facts: x, sel, focus, open, pending, onToggle, onFocus, onOpen }: ItemRowProps) {
  const note = p.triage_note;
  return (
    <div role="row" className={'tr-row s-' + p.status + (sel ? ' tr-sel' : '') + (focus ? ' tr-fx' : '') + (open ? ' tr-open' : '')} aria-selected={sel} data-fid={p.id} data-role="tr-row"
      tabIndex={focus ? 0 : -1} onFocus={(e) => { if (e.target === e.currentTarget) onFocus(p.id); }}
      onClick={(e) => { if ((e.target as HTMLElement).closest('input')) return; onOpen(p.id); }}>
      <span role="cell" className="c-sel"><input type="checkbox" tabIndex={-1} checked={sel} onChange={() => { onFocus(p.id); onToggle(p.id); }} aria-label={'Select ' + p.id} /></span>
      <span role="cell" className="c-lens"><LensTag id={p.lens} /></span>
      <span role="cell" className="c-feat" title={fname}>{fname}<small>{p.id}{x && x.attempt > 1 ? ' · attempt ' + x.attempt + (x.prev ? ' of ' + x.prev : '') : ''}</small></span>
      <span role="cell" className="c-title" data-role="tr-row-title">
        <span>{p.title}</span>
        {note ? <small className={p.status === 'accepted' && !x?.flagged ? 'dn' : undefined}>“{note}”</small>
          : x?.prevNote ? <small>↺ from attempt {x.attempt - 1}: “{x.prevNote}”</small> : null}
      </span>
      <span role="cell" className="c-mv"><MetricMove before={x?.before} after={x?.after} unit={x?.unit} metric={p.metric} /></span>
      <span role="cell" className="c-vd">{x ? <VerdictChip verdict={x.verdict} failed={x.failed} /> : null}</span>
      <span role="cell" className="c-ev"><Evidence p={p} x={x} /></span>
      <span role="cell" className="c-st"><StateMark status={p.status} flagged={!!x?.flagged} pending={pending} /></span>
    </div>
  );
});
