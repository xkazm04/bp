'use client';
// Impact queue: the open findings ranked by expected value per effort (useLedger's `rankValue`, the order
// `/lens-scan execute` builds a batch in), a running "selected effort" against a budget of two L items, and a
// suggested batch: the best-ranked findings that fit the budget, ticked on arrival when nothing else is selected.
import { memo, useEffect, useRef } from 'react';
import { BUDGET, sizeW, type Finding, type Ledger } from '../useLedger';
import { FeatureLink, KindTag, LensTag, Move, Risk, Size, StatusChip, fromControl } from './bits';

const Item = memo(function Item({ f, L, i, on, focus, sug, cum }: { f: Finding; L: Ledger; i: number; on: boolean; focus: boolean; sug: boolean; cum: number }) {
  const lens = L.lenses.find((l) => l.id === f.p.lens);
  return (
    <li className={'lg-qi' + (on ? ' on' : '') + (sug ? ' sug' : '')} data-fid={f.p.id} tabIndex={focus ? 0 : -1}
      onFocus={() => L.setFocus(f.p.id)} onClick={(e) => { L.setFocus(f.p.id); if (!fromControl(e)) L.toggle(f.p.id); }}>
      <span className="no">{i + 1}</span>
      <input type="checkbox" tabIndex={-1} checked={on} onChange={() => L.toggle(f.p.id)} aria-label={'Select ' + f.p.title} />
      <div className="mid">
        <div className="top"><LensTag lens={lens} /><span className="lg-t">{f.p.title}</span><KindTag p={f.p} />{sug ? <span className="lg-sugt">suggested</span> : null}</div>
        <div className="sub"><FeatureLink f={f} L={L} act={focus} /><Move f={f} L={L} /><Risk p={f.p} /><Size p={f.p} /><StatusChip f={f} /></div>
      </div>
      <span className="ev" title={'Value per effort ' + f.ev.toFixed(3) + '; effort ' + sizeW(f.p) + '; effort of this and every finding above it: ' + cum}><b>{f.ev.toFixed(2)}</b><span>effort {sizeW(f.p)} · Σ {cum}</span></span>
    </li>
  );
});

export function Queue({ L }: { L: Ledger }) {
  const sug = new Set(L.suggested), ticked = useRef(false);
  // the suggested batch comes pre-ticked when the queue opens with nothing selected
  useEffect(() => {
    if (ticked.current) return;
    ticked.current = true;
    if (!L.ui.sel.size && L.suggested.length) L.select(L.suggested, true);
  }, [L]);
  const first = L.ranked[0]?.p.id, foc = L.ui.focus && L.ranked.some((f) => f.p.id === L.ui.focus) ? L.ui.focus : first;
  const pct = Math.min(100, (L.effort / BUDGET) * 100), sugEffort = L.suggested.reduce((s, id) => s + sizeW(L.byId.get(id)!.p), 0);
  let cum = 0;
  return (
    <div className="lg-queue">
      <div className="lg-qh">
        <div className="lg-meter" role="meter" aria-valuemin={0} aria-valuemax={BUDGET} aria-valuenow={L.effort} aria-label="Selected effort against the budget">
          <span>Selected effort <b>{L.effort}</b> of {BUDGET} <em>(2 × L)</em></span>
          <i aria-hidden="true"><s style={{ width: pct + '%' }} className={L.effort > BUDGET ? 'over' : ''} /></i>
        </div>
        <button type="button" className="bt" disabled={!L.suggested.length} onClick={() => { L.clear(); L.select(L.suggested, true); }}
          title="Select the suggested batch only">Suggested batch · {L.suggested.length} · effort {sugEffort}</button>
        <details className="lg-how">
          <summary>How the order is computed</summary>
          <p>Value per effort = gain × confidence ÷ effort. Gain is the expected move against the largest move proposed for the same metric (0.25 to 1; 0.5 when a finding names no metric). Confidence is (11 − risk) ÷ 10. Effort is the size: XS 1, S 2, M 3, L 5, XL 8. The suggested batch takes findings in this order while they fit {BUDGET}.</p>
        </details>
      </div>
      {L.ranked.length ? (
        <ol className="lg-ql" aria-label="Open findings, best value per effort first">
          {L.ranked.map((f, i) => { cum += sizeW(f.p); return <Item key={f.p.id} f={f} L={L} i={i} on={L.ui.sel.has(f.p.id)} focus={f.p.id === foc} sug={sug.has(f.p.id)} cum={cum} />; })}
        </ol>
      ) : <div className="lg-zero" role="status"><b>Inbox zero</b>Nothing open to rank{L.ui.lens.size || L.ui.q ? ' under these filters' : ''}.</div>}
    </div>
  );
}
