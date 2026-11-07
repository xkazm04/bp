'use client';
// Direction A, the Schedule: the ledger as the schedule sheet of a drawing set. A sheet ruled in sections, one per lens, each
// with the wing's lettered head and stage bar; rows of a line and a half; and the waves permanently docked in the right
// column, so the place a finding goes is on screen while you read it. Every row carries its wave slots; 1-9 does the same.
// The densest of the three, and the closest to the page people already know: the bet is speed.
import { useMemo } from 'react';
import { useEngine } from '../../hooks';
import { lensMeta, type Finding } from '../useLedger';
import { LensGlyph, Risk, Size } from '../variants/bits';
import { Line, Meter, NewWave, Pin, Slots, StageBar, WaveCard, useCarry, useDrop, useLab } from './parts';
import type { ReactNode } from 'react';

function Row({ f, mvp }: { f: Finding; mvp: boolean }) {
  const { L, B, focusId } = useLab(), carry = useCarry(), at = B.spot.get(f.p.id), mv = L.move(f.p), on = L.ui.sel.has(f.p.id);
  return (
    <div role="row" className={'lx-row-f' + (on ? ' on' : '') + (focusId === f.p.id ? ' focus' : '') + (at?.draft ? ' placed' : '')} data-fid={f.p.id} tabIndex={focusId === f.p.id ? 0 : -1} {...carry(f.p.id)}
      onClick={(e) => { if (e.shiftKey || e.ctrlKey || e.metaKey) L.toggle(f.p.id); else L.setFocus(f.p.id); }}>
      <span role="cell" className="c-sel"><input type="checkbox" tabIndex={-1} checked={on} onClick={(e) => e.stopPropagation()} onChange={() => L.toggle(f.p.id)} aria-label={'Select ' + f.p.title} /></span>
      <span role="cell" className="c-pin"><Pin f={f} n={at?.draft ? at.n : undefined} mvp={mvp} /></span>
      <span role="cell" className="c-t">
        <span className="lx-t">{f.p.title}</span>
        <span className="lx-sub"><button type="button" className="lx-flink" tabIndex={-1} disabled={!f.fid} onClick={(e) => { e.stopPropagation(); L.openFeature(f); }}>{f.fname}</button>{mv ? <><i>·</i>{mv}</> : null}</span>
      </span>
      <span role="cell" className="c-sc"><Meter f={f} /></span>
      <span role="cell" className="c-r"><Risk p={f.p} /></span>
      <span role="cell" className="c-s"><Size p={f.p} /></span>
      <span role="cell" className="c-w"><Slots f={f} /></span>
    </div>
  );
}

function Section({ letter, lens, items, mvp, extra }: { letter: string; lens: string; items: readonly Finding[]; mvp: string | undefined; extra?: ReactNode }) {
  const { L, B } = useLab(), P = useEngine().M.P, l = lensMeta(P, lens), can = items.filter((f) => f.can && !B.spot.get(f.p.id)?.draft).map((f) => f.p.id);
  return (
    <>
      <header className="lx-sec-h" role="row" aria-label={l.name}>
        <span className="lx-letter">{letter}</span>
        <LensGlyph g={l.glyph} px={16} />
        <h3>{l.name}</h3>
        <span className="lx-sec-n">{items.length}</span>
        <StageBar items={items} />
        <span className="lx-sp" />
        {can.length ? <button type="button" className="lx-all" onClick={() => L.select(can)} title={'Select every finding of ' + l.name + ' that can go and no wave holds'}>Select {can.length}</button> : null}
      </header>
      {items.map((f) => <Row key={f.p.id} f={f} mvp={f.p.id === mvp} />)}
      {extra}
    </>
  );
}

export function Schedule({ brief }: { brief: ReactNode }) {
  const { L, B } = useLab(), drop = useDrop();
  const groups = useMemo(() => {
    const by = new Map<string, Finding[]>();
    for (const f of L.rows) { if (f.w.band === 'reserve') continue; const a = by.get(f.p.lens); if (a) a.push(f); else by.set(f.p.lens, [f]); }
    const reserved = new Set(L.reserve.map((g) => g.lens));
    for (const lens of reserved) if (!by.has(lens)) by.set(lens, []);
    return L.lenses.filter((l) => by.has(l.id)).map((l) => ({ lens: l.id, items: by.get(l.id)! }));
  }, [L.rows, L.reserve, L.lenses]);
  const mvp = useMemo(() => new Map(L.mvps.map((m) => [m.lens, m.f.p.id])), [L.mvps]);
  return (
    <div className="lx-a">
      <div className="lx-sheet" role="table" aria-label="Findings" {...drop({ wave: null })}>
        <div className="lx-head" role="row">
          <span role="columnheader" className="c-sel"><span className="vh">Selected</span></span>
          <span role="columnheader" className="c-pin"><span className="vh">Lens</span></span>
          <span role="columnheader" className="c-t">Finding · feature · before → expected</span>
          <span role="columnheader" className="c-sc">Score</span>
          <span role="columnheader" className="c-r">Risk</span>
          <span role="columnheader" className="c-s">Size</span>
          <span role="columnheader" className="c-w">Wave</span>
        </div>
        {groups.length ? groups.map((g, i) => {
          const rsv = L.reserve.find((r) => r.lens === g.lens);
          return (
            <Section key={g.lens} letter={String.fromCharCode(65 + i)} lens={g.lens} items={g.items} mvp={mvp.get(g.lens)} extra={rsv ? (
              <>
                <button type="button" className="lx-rsv" aria-expanded={rsv.open} onClick={() => L.toggleReserve(g.lens)} title="Found, verified and scored, but over the run's cap">{rsv.open ? '▾' : '▸'} {rsv.items.length} in reserve</button>
                {rsv.open ? rsv.items.map((f) => <Row key={f.p.id} f={f} mvp={false} />) : null}
              </>
            ) : null} />
          );
        }) : <p className="lx-none">{L.all.length ? 'No finding matches these filters.' : 'No findings yet. A lens scan proposes them.'}</p>}
      </div>
      <aside className="lx-dock" aria-label="Waves">
        <div className="lx-dock-w">
          {B.waves.map((w) => <WaveCard key={w.id} w={w} n={B.drafts.indexOf(w) + 1} form="dock" renderItem={(id, p) => <Line key={id} id={id} p={p} />} />)}
          <NewWave form="dock" />
        </div>
        <div className="lx-brief">{brief}</div>
      </aside>
    </div>
  );
}
