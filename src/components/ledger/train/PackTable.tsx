'use client';
// The In packs scope of the triage table (contest A/1's triageView): a sticky head row, then each pack oldest first,
// its sticky pack row over its shown items. The rows are memoised (ItemRow, PackRow) and skip layout off screen
// (`content-visibility: auto`), so a decision repaints one row. The focused row is the ledger's `focus` when it is
// shown, else the first; clicking a row opens it in the compare panel. Below ~760 px of width (the phone, a split
// screen, a docked compare) a row folds into a two-line card, A/1's container breakpoints.
import { useCallback, useMemo } from 'react';
import type { Ledger } from '../useLedger';
import { useDecide } from './Decide';
import { ItemRow, useItemFacts } from './ItemRow';
import { PackRow } from './PackRow';
import { Callout } from './ui/Controls';
import './PackTable.css';

export interface PackTableProps {
  L: Ledger;
  /** Kettle's sample train (the SAMPLE tags). */
  sample: boolean;
  /** Open the Lenses panel (the empty state's way to run a lens execute). */
  onLenses(): void;
}

export function PackTable({ L, sample, onLenses }: PackTableProps) {
  const facts = useItemFacts(), { pending } = useDecide();
  const { ui, set } = L;
  const first = L.scoped[0]?.p.id, foc = ui.focus && L.scoped.some((f) => f.p.id === ui.focus) ? ui.focus : first;
  const onOpen = useCallback((id: string) => set((u) => (u.open === id && u.focus === id ? u : { ...u, focus: id, open: id })), [set]);
  // by the ledger's parts, never the Ledger object (new on every render): a J/K step must not re-render the pack rows
  const { packs, select } = L;
  const onSelect = useCallback((packId: string) => {
    const k = packs.find((x) => x.pack.id === packId);
    if (k) select(k.shown.map((f) => f.p.id));
  }, [packs, select]);
  const progress = useMemo(() => new Map(L.packs.map((k) => [k.pack.id, k.items.map((f) => ({ id: f.p.id, status: f.status }))])), [L.packs]);

  if (!L.packs.length) return (
    <div className="tr-pt-empty">
      <Callout tone="empty">
        <b>No packs yet.</b> A lens execute builds its approved findings into a pack on its own branch; its items land here to
        be accepted, sent back or descoped. <button type="button" className="tr-lnk" onClick={onLenses}>Open the Lenses panel</button> to run one,
        or switch to <button type="button" className="tr-lnk" onClick={() => L.setScope('backlog')}>Backlog</button> to dispatch findings.
      </Callout>
    </div>
  );
  if (!L.scoped.length) return (
    <div className="tr-pt-empty">
      <Callout tone="empty">
        No item matches these filters. <button type="button" className="tr-lnk" onClick={() => set((u) => ({ ...u, lens: new Set(), status: new Set(), feat: new Set(), q: '' }))}>Clear the filters</button>
      </Callout>
    </div>
  );
  return (
    <div role="table" className="tr-pt" aria-label="Pack items" data-role="tr-table">
      <div role="row" className="tr-thead" data-role="tr-thead">
        <span role="columnheader"><span className="tr-vh">Selected</span></span>
        <span role="columnheader">Lens</span>
        <span role="columnheader" className="c-feat">Feature</span>
        <span role="columnheader">Item</span>
        <span role="columnheader">Before → after</span>
        <span role="columnheader" className="c-vd">Verdict</span>
        <span role="columnheader" className="c-ev">Evidence</span>
        <span role="columnheader">Status</span>
      </div>
      {L.packs.map((k) => {
        if (!k.shown.length) return null;
        const ids = k.shown.map((f) => f.p.id), n = ids.filter((id) => ui.sel.has(id)).length;
        return (
          <div role="rowgroup" key={k.pack.id} aria-label={k.pack.id}>
            <PackRow pack={k.pack} items={progress.get(k.pack.id) ?? []} all={n === ids.length} some={n > 0} sample={sample} onSelect={onSelect} />
            {k.shown.map((f) => (
              <ItemRow key={f.p.id} p={f.p} fname={f.fname} facts={facts.get(f.p.id)} sel={ui.sel.has(f.p.id)} focus={f.p.id === foc} open={f.p.id === ui.open}
                pending={pending.has(f.p.id)} onToggle={L.toggle} onFocus={L.setFocus} onOpen={onOpen} />
            ))}
          </div>
        );
      })}
    </div>
  );
}
