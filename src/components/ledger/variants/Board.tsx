'use client';
// Status board: a column per state (proposed, approved, executing, done · failed), cards grouped by lens. Dragging a
// proposed card onto Approved, or A on a focused card, dispatches it (with the rest of the selection when the card is
// selected): good for watching execution move. Space selects, D dispatches the selection.
import { memo, useState } from 'react';
import { boardCols, type Finding, type Ledger } from '../useLedger';
import { FeatureLink, KindTag, LensTag, Move, Risk, Size, StatusChip, fromControl } from './bits';

const DRAG = 'application/x-bp-finding';

const Card = memo(function Card({ f, L, on, focus }: { f: Finding; L: Ledger; on: boolean; focus: boolean }) {
  return (
    <li className={'lg-card' + (on ? ' on' : '') + ' s-' + f.status} data-fid={f.p.id} tabIndex={focus ? 0 : -1} draggable={f.can}
      onDragStart={(e) => { e.dataTransfer.setData(DRAG, f.p.id); e.dataTransfer.effectAllowed = 'move'; }}
      onFocus={() => L.setFocus(f.p.id)}
      onClick={(e) => { L.setFocus(f.p.id); if (!fromControl(e)) L.toggle(f.p.id); }}>
      <div className="k"><span>{on ? <span className="vh">Selected. </span> : null}{f.p.id}</span><KindTag p={f.p} /></div>
      <div className="lg-t">{f.p.title}</div>
      <div className="row"><FeatureLink f={f} L={L} act={focus} /></div>
      <Move f={f} L={L} />
      <div className="row"><Risk p={f.p} /><Size p={f.p} /><StatusChip f={f} /></div>
    </li>
  );
});

export function Board({ L }: { L: Ledger }) {
  const cols = boardCols(L.rows, L.lenses);
  const [over, setOver] = useState<string | null>(null);
  const first = cols.find((c) => c.n)?.groups[0]?.items[0]?.p.id, foc = L.ui.focus && L.byId.has(L.ui.focus) ? L.ui.focus : first;
  const drop = (e: React.DragEvent) => {
    e.preventDefault(); setOver(null);
    const id = e.dataTransfer.getData(DRAG); if (!id) return;
    void L.dispatchIds(L.ui.sel.has(id) ? [...L.ui.sel] : [id]);
  };
  return (
    <div className="lg-board">
      {cols.map((c) => {
        const target = c.k === 'approved';
        return (
          <section key={c.k} className={'lg-col' + (target && over === c.k ? ' drop' : '')} aria-label={c.label + ', ' + c.n}
            onDragOver={target ? (e) => { if (e.dataTransfer.types.includes(DRAG)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setOver(c.k); } } : undefined}
            onDragLeave={target ? (e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null); } : undefined}
            onDrop={target ? drop : undefined}>
            <h3><span>{c.label}</span><span>{c.n}</span></h3>
            {target ? <p className="lg-hint">Drop a proposed card here, or press A on it, to dispatch it.</p> : null}
            {c.groups.map((g) => (
              <div key={g.lens.id} className="lg-grp">
                <h4><LensTag lens={g.lens} short={false} /><span>{g.items.length}</span></h4>
                <ul>{g.items.map((f) => <Card key={f.p.id} f={f} L={L} on={L.ui.sel.has(f.p.id)} focus={f.p.id === foc} />)}</ul>
              </div>
            ))}
            {!c.n ? <p className="lg-none">{c.k === 'proposed' ? 'Inbox zero.' : 'None.'}</p> : null}
          </section>
        );
      })}
    </div>
  );
}
