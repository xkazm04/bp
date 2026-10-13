'use client';
// Triage table: one dense, keyboard-first row per finding (lens, feature, title, before → expected, risk, size,
// status), open ones first and best value per effort first within a status. J/K move, Space selects, D dispatches,
// Enter opens the feature; the goal is an empty Proposed list ("inbox zero"). Below ~720 px a row folds into a
// two-line card, the phone's ledger.
import { memo } from 'react';
import type { Finding, Ledger } from '../useLedger';
import { FeatureLink, KindTag, LensTag, Move, Risk, Size, StatusChip, fromControl } from './bits';

const Row = memo(function Row({ f, L, on, focus }: { f: Finding; L: Ledger; on: boolean; focus: boolean }) {
  const lens = L.lenses.find((l) => l.id === f.p.lens);
  return (
    <div role="row" className={'lg-tr' + (on ? ' on' : '') + ' s-' + f.status} data-fid={f.p.id} tabIndex={focus ? 0 : -1}
      onFocus={() => L.setFocus(f.p.id)}
      onClick={(e) => { L.setFocus(f.p.id); if (!fromControl(e)) L.toggle(f.p.id); }}>
      <span role="cell" className="c-sel"><input type="checkbox" tabIndex={-1} checked={on} onChange={() => L.toggle(f.p.id)} aria-label={'Select ' + f.p.title} /></span>
      <span role="cell" className="c-lens"><LensTag lens={lens} /></span>
      <span role="cell" className="c-feat"><FeatureLink f={f} L={L} act={focus} /></span>
      <span role="cell" className="c-title"><span className="lg-t">{f.p.title}</span><KindTag p={f.p} /></span>
      <span role="cell" className="c-mv"><Move f={f} L={L} /></span>
      <span role="cell" className="c-risk"><Risk p={f.p} /></span>
      <span role="cell" className="c-size"><Size p={f.p} /></span>
      <span role="cell" className="c-st"><StatusChip f={f} /></span>
    </div>
  );
});

export function Triage({ L }: { L: Ledger }) {
  const open = L.rows.filter((f) => f.status === 'proposed').length;
  const proposedShown = !L.ui.status.size || L.ui.status.has('proposed');
  const first = L.rows[0]?.p.id, foc = L.ui.focus && L.byId.has(L.ui.focus) ? L.ui.focus : first;
  return (
    <div className="lg-tri">
      {proposedShown && !open && L.all.length ? <div className="lg-zero" role="status"><b>Inbox zero</b>Nothing proposed{L.ui.lens.size || L.ui.q ? ' under these filters' : ''}. New findings land here as scans propose them.</div> : null}
      {L.rows.length ? (
        <div role="table" className="lg-tbl" aria-label="Findings">
          <div role="rowgroup" className="lg-th">
            <div role="row" className="lg-tr hd">
              <span role="columnheader" className="c-sel"><span className="vh">Selected</span></span>
              <span role="columnheader" className="c-lens">Lens</span>
              <span role="columnheader" className="c-feat">Feature</span>
              <span role="columnheader" className="c-title">Finding</span>
              <span role="columnheader" className="c-mv">Before → expected</span>
              <span role="columnheader" className="c-risk">Risk</span>
              <span role="columnheader" className="c-size">Size</span>
              <span role="columnheader" className="c-st">Status</span>
            </div>
          </div>
          <div role="rowgroup">
            {L.rows.map((f) => <Row key={f.p.id} f={f} L={L} on={L.ui.sel.has(f.p.id)} focus={f.p.id === foc} />)}
          </div>
        </div>
      ) : <div className="lg-empty">{L.all.length ? 'No finding matches these filters.' : 'No findings yet. A lens scan proposes them; they appear here as it does.'}</div>}
    </div>
  );
}
