// The Release tab's package: the accepted items with no release (before a draft) or the open release's items, grouped
// by lens, each its commit, title, feature and before -> after; a flagged item (rules.ts isFlagged) carries its triage
// note. Then the rework queue (a cherry-pick conflict's note marked) and the descoped items with their notes. Undo is
// the reopen decision through the one decision path (Decide.tsx), offered while the planner (plan.ts planDecision)
// says it applies: not pending, the release still a draft, the item not rebuilt by a newer attempt; otherwise it stays
// focusable with its why (Btn reason); Compare opens the item's evidence in the triage table's compare panel.
import { memo, useMemo } from 'react';
import type { Proposal } from '@bp/core/scan/types';
import { useEngine, useWritesOn } from '../../../hooks';
import { setLedgerUi } from '../../useLedger';
import { useDecide } from '../Decide';
import { planDecision, type PlanData } from '../plan';
import { LensTag } from '../ui/Marks.tsx';
import { Btn, Callout } from '../ui/Controls';
import { byLens, isConflict, moveText, STATUS_WORD, type PkgItem, type ReleaseModel } from './releaseState';

interface RowCtl {
  T: PlanData;
  /** false while triage is read-only (BP_WRITES=off): Undo is hidden. */
  writes: boolean;
  phone: boolean;
  pending: ReadonlySet<string>;
  undo(id: string): void;
  compare(id: string): void;
}

const short = (sha: string | undefined) => (sha ? sha.slice(0, 7) : 'no sha');

const UndoBtn = ({ p, c }: { p: Proposal; c: RowCtl }) => {
  if (!c.writes) return null;
  const busy = c.pending.has(p.id), plan = busy ? null : planDecision(c.T, [p.id], 'reopen');
  const why = plan && 'why' in plan ? plan.why : undefined;
  return <Btn size="row" disabled={c.phone || busy} reason={c.phone ? undefined : why} title={busy ? 'Undoing…' : 'Undo the decision (back to waiting)'} onClick={() => c.undo(p.id)}>{busy ? 'Undoing' : 'Undo'}</Btn>;
};

const PkgRow = memo(function PkgRow({ x, c }: { x: PkgItem; c: RowCtl }) {
  const p = x.p, why = p.triaged_from === 'failed' ? 'failed' : x.verdict;
  return (
    <li data-fid={p.id}>
      <span className="sha">{short(p.commit_sha)}</span>
      <span className="t">{p.title}
        <small className={x.flagged ? 'fl' : undefined}>{p.feature} · {p.metric ? p.metric + ' ' : ''}{moveText(x)}{x.flagged ? ` · ⚑ accepted ${why}${p.triage_note ? ': “' + p.triage_note + '”' : ''}` : ''}</small>
      </span>
      <Btn size="row" title="Compare its before and after" onClick={() => c.compare(p.id)}>Compare</Btn>
      <UndoBtn p={p} c={c} />
    </li>
  );
});

const NoteRow = memo(function NoteRow({ p, c, struck }: { p: Proposal; c: RowCtl; struck?: boolean }) {
  const note = p.triage_note ?? '';
  return (
    <li data-fid={p.id}>
      <span><LensTag id={p.lens} /></span>
      <span className="t">{struck ? <s>{p.title}</s> : p.title}
        <small className={isConflict(p) ? 'warn' : undefined}>{isConflict(p) ? '⚠ ' : ''}{struck ? '“' + note + '”' : note || 'no note'}</small>
      </span>
      <span />
      <UndoBtn p={p} c={c} />
    </li>
  );
});

export function Package({ m, phone }: { m: ReleaseModel; phone: boolean }) {
  const E = useEngine(), d = useDecide(), { pending, decide } = d, writes = useWritesOn();
  const c = useMemo<RowCtl>(() => {
    return {
      T: m.T, phone, writes, pending,
      undo: (id) => void decide([id], 'reopen'),
      compare: (id) => { setLedgerUi((u) => ({ ...u, open: id, scope: 'packs' })); E.setPage('ledger', 'triage'); },
    };
  }, [m.T, phone, writes, pending, decide, E]);
  const props = m.T.proposals;
  const rework = props.filter((p) => p.status === 'rework'), descoped = props.filter((p) => p.status === 'descoped' && p.pack_id);
  return (
    <div className="tr-rel-pkg" data-role="tr-rel-pkg">
      {m.items.length ? (
        <ul className="tr-pl">
          {byLens(m.items).map(([lens, xs]) => [
            <li key={'g:' + lens} className="lgrp"><LensTag id={lens} full /> · {xs.length}</li>,
            ...xs.map((x) => <PkgRow key={x.p.id} x={x} c={c} />),
          ])}
        </ul>
      ) : (
        <Callout tone="empty" role="tr-rel-empty">
          {m.rel ? 'Every item left this release.' : 'Nothing accepted yet.'} Accept items in the{' '}
          <button type="button" className="lnk" onClick={() => { setLedgerUi((u) => ({ ...u, scope: 'packs' })); E.setPage('ledger', 'triage'); }}>triage table</button> (A); they join this package.
        </Callout>
      )}
      {m.rel && m.free ? <p className="tr-rel-hint">{m.free} accepted item{m.free === 1 ? '' : 's'} wait for the next release (v{m.rel.version} · {STATUS_WORD[m.rel.status]}).</p> : null}
      <h3>Rework queue · {rework.length}</h3>
      {rework.length ? <ul className="tr-pl">{rework.map((p) => <NoteRow key={p.id} p={p} c={c} />)}</ul>
        : <p className="tr-rel-none">Empty. Items sent back with R land here with their note.</p>}
      <h3>Descoped · {descoped.length}</h3>
      {descoped.length ? <ul className="tr-pl">{descoped.map((p) => <NoteRow key={p.id} p={p} c={c} struck />)}</ul>
        : <p className="tr-rel-none">None dropped.</p>}
    </div>
  );
}
