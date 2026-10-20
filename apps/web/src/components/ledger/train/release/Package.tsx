// The Release tab's package: the accepted items with no release (before a draft) or the open release's items, grouped
// by lens, each its commit, title, feature and before -> after; a flagged item (rules.ts isFlagged) carries its triage
// note. Then the rework queue (a cherry-pick conflict's note marked) and the descoped items with their notes. Undo is
// the reopen decision through the one decision path (Decide.tsx), offered while rules.ts canDecide allows it (the
// release is still a draft); Compare opens the item's evidence in the triage table's compare panel.
import { memo, useMemo } from 'react';
import type { Proposal, Release } from '@bp/core/scan/types';
import { canDecide } from '@bp/core/train/rules';
import { useEngine } from '../../../hooks';
import { setLedgerUi } from '../../useLedger';
import { useDecide } from '../Decide';
import { LensTag } from '../ui/Marks.tsx';
import { Btn, Callout } from '../ui/Controls';
import { byLens, isConflict, moveText, type PkgItem, type ReleaseModel } from './releaseState';

interface RowCtl {
  rel?: Release;
  phone: boolean;
  pending: ReadonlySet<string>;
  undo(id: string): void;
  compare(id: string): void;
}

const short = (sha: string | undefined) => (sha ? sha.slice(0, 7) : 'no sha');

const UndoBtn = ({ p, c, why }: { p: Proposal; c: RowCtl; why?: string }) => {
  const off = c.phone || c.pending.has(p.id) || !canDecide('reopen', p, c.rel) || !!why;
  const title = why ?? (c.pending.has(p.id) ? 'Undoing…' : !canDecide('reopen', p, c.rel) ? 'Locked: the release left draft' : 'Undo the decision (back to waiting)');
  return <Btn size="row" disabled={off} title={title} onClick={() => c.undo(p.id)}>{c.pending.has(p.id) ? 'Undoing' : 'Undo'}</Btn>;
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

const NoteRow = memo(function NoteRow({ p, c, struck, rebuilt }: { p: Proposal; c: RowCtl; struck?: boolean; rebuilt?: string }) {
  const note = p.triage_note ?? '';
  return (
    <li data-fid={p.id}>
      <span><LensTag id={p.lens} /></span>
      <span className="t">{struck ? <s>{p.title}</s> : p.title}
        <small className={isConflict(p) ? 'warn' : undefined}>{isConflict(p) ? '⚠ ' : ''}{struck ? '“' + note + '”' : note || 'no note'}</small>
      </span>
      <span />
      <UndoBtn p={p} c={c} why={rebuilt ? 'Rebuilt as ' + rebuilt + ': undo that one instead' : undefined} />
    </li>
  );
});

export function Package({ m, phone }: { m: ReleaseModel; phone: boolean }) {
  const E = useEngine(), d = useDecide(), rel = m.rel, { pending, decide } = d;
  const c = useMemo<RowCtl>(() => {
    const o: RowCtl = {
      phone, pending,
      undo: (id) => void decide([id], 'reopen'),
      compare: (id) => { setLedgerUi((u) => ({ ...u, open: id, scope: 'packs' })); E.setPage('ledger', 'triage'); },
    };
    if (rel) o.rel = rel;
    return o;
  }, [phone, pending, decide, rel, E]);
  const props = m.T.proposals;
  const rework = props.filter((p) => p.status === 'rework'), descoped = props.filter((p) => p.status === 'descoped' && p.pack_id);
  const rebuiltBy = new Map<string, string>();
  for (const p of props) if (p.attempt_of) rebuiltBy.set(p.attempt_of, p.id);
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
      {m.rel && m.free ? <p className="tr-rel-hint">{m.free} accepted item{m.free === 1 ? '' : 's'} wait for the next release (v{m.rel.version} is {m.rel.status}).</p> : null}
      <h3>Rework queue · {rework.length}</h3>
      {rework.length ? <ul className="tr-pl">{rework.map((p) => <NoteRow key={p.id} p={p} c={c} rebuilt={rebuiltBy.get(p.id)} />)}</ul>
        : <p className="tr-rel-none">Empty. Items sent back with R land here with their note.</p>}
      <h3>Descoped · {descoped.length}</h3>
      {descoped.length ? <ul className="tr-pl">{descoped.map((p) => <NoteRow key={p.id} p={p} c={c} struck />)}</ul>
        : <p className="tr-rel-none">None dropped.</p>}
    </div>
  );
}
