'use client';
// The Backlog on a wide window: the schedule sheet of the drawing set (owner's pick of three directions, 2026-11-07). A sheet
// ruled in sections, one per lens, each with the wing's lettered head and stage bar; rows of a line and a half; and the waves
// permanently docked beside it (WaveDock, placed by LedgerPage), so where a finding goes is on screen while you read it. Every
// row carries its wave slots; 1-9 does the same. The lens MVP wears a star, reserve findings fold under their lens. The phone
// keeps variants/Triage.tsx, whose rows fold into cards.
// The rows are memoised over plain props and off-screen rows skip layout (as Triage's): a J/K step re-renders two rows.
import { memo, useMemo, useRef } from 'react';
import { useEngine } from '../../hooks';
import { OriginChip, TierChip } from '../../Queue';
import { StateMark } from '../train/ui/Marks.tsx';
import { lensMeta, type Finding, type Ledger } from '../useLedger';
import { KindTag, LensGlyph, Risk, Size, Verdict } from '../variants/bits';
import type { Spot } from './bench';
import { Meter, NewWave, Pin, Slots, StageBar, WaveCard, carry, useBacklog, useDrop, type CarryApi } from './parts';

interface RowProps {
  f: Finding;
  on: boolean;
  focus: boolean;
  mvp: boolean;
  max: number;
  /** The draft holding it: its id and place number; absent when none does. */
  atWave: string | undefined;
  atN: number | undefined;
  /** Every draft as `id<TAB>name` lines: a string, so the memo compares by value. */
  drafts: string;
  api: CarryApi;
  onFocus(id: string): void;
  onToggle(id: string): void;
  onOpen(f: Finding): void;
  move(p: Finding['p']): string | null;
}

const Row = memo(function Row({ f, on, focus, mvp, max, atWave, atN, drafts, api, onFocus, onToggle, onOpen, move }: RowProps) {
  const mv = move(f.p), id = f.p.id;
  return (
    <div role="row" className={'sc-row s-' + f.status + (on ? ' on' : '') + (focus ? ' focus' : '') + (atWave ? ' placed' : '')} data-fid={id} tabIndex={focus ? 0 : -1} {...(f.can || atWave ? carry(api, id) : {})}
      onFocus={(e) => { if (e.target === e.currentTarget) onFocus(id); }}
      onClick={(e) => { if (e.shiftKey || e.ctrlKey || e.metaKey) onToggle(id); else onFocus(id); }}>
      <span role="cell" className="c-sel"><input type="checkbox" tabIndex={-1} checked={on} onClick={(e) => e.stopPropagation()} onChange={() => onToggle(id)} aria-label={'Select ' + f.p.title} /></span>
      <span role="cell" className="c-pin"><Pin lens={f.p.lens} status={f.status} risk={f.p.risk} n={atN} mvp={mvp} /></span>
      <span role="cell" className="c-t">
        <span className="sc-t"><TierChip p={f.p} /><span className="sc-tt">{f.p.title}</span><KindTag p={f.p} /><OriginChip p={f.p} act={focus} /><Verdict p={f.p} /></span>
        <span className="sc-sub">
          {f.status !== 'proposed' || f.job ? <StateMark status={f.status} job={f.job} /> : null}
          <button type="button" className="sc-flink" tabIndex={-1} disabled={!f.fid} title={f.fid ? 'Open ' + f.fname + ' on its ' + f.p.lens + ' tab' : f.p.feature + ' is not on this map'} onClick={(e) => { e.stopPropagation(); onOpen(f); }}>{f.fname}</button>
          {mv ? <><i>·</i>{mv}</> : null}
        </span>
      </span>
      <span role="cell" className="c-sc"><Meter f={f} max={max} /></span>
      <span role="cell" className="c-r"><Risk p={f.p} /></span>
      <span role="cell" className="c-s"><Size p={f.p} /></span>
      <span role="cell" className="c-w"><Slots id={id} title={f.p.title} at={atWave} drafts={drafts} api={api} canPlace={f.can || !!atWave} /></span>
    </div>
  );
});

function SectionHead({ letter, lens, items, spot, L }: { letter: string; lens: string; items: readonly Finding[]; spot: ReadonlyMap<string, Spot>; L: Ledger }) {
  const P = useEngine().M.P, l = lensMeta(P, lens), can = items.filter((f) => f.can && !spot.get(f.p.id)?.draft).map((f) => f.p.id);
  return (
    <header className="sc-sec-h" role="row" aria-label={l.name}>
      <span className="sc-letter">{letter}</span>
      <LensGlyph g={l.glyph} px={16} />
      <h3>{l.name}</h3>
      <span className="sc-sec-n">{items.length}</span>
      <StageBar items={items} />
      <span className="sc-sp" />
      {can.length ? <button type="button" className="sc-all" tabIndex={-1} onClick={() => L.select(can)} title={'Select every finding of ' + l.name + ' that can go and no wave holds'}>Select {can.length}</button> : null}
    </header>
  );
}

export function Schedule() {
  const { L, B } = useBacklog(), drop = useDrop();
  const groups = useMemo(() => {
    const by = new Map<string, Finding[]>();
    for (const f of L.rows) { if (f.w.band === 'reserve') continue; const a = by.get(f.p.lens); if (a) a.push(f); else by.set(f.p.lens, [f]); }
    for (const r of L.reserve) if (!by.has(r.lens)) by.set(r.lens, []);
    return L.lenses.filter((l) => by.has(l.id)).map((l) => ({ lens: l.id, items: by.get(l.id)! }));
  }, [L.rows, L.reserve, L.lenses]);
  const mvp = useMemo(() => new Set(L.mvps.map((m) => m.f.p.id)), [L.mvps]);
  const max = useMemo(() => L.all.reduce((m, f) => Math.max(m, f.w.value ?? 0), 0), [L.all]);
  const drafts = B.drafts.map((w) => w.id + '\t' + w.name).join('\n');
  const selRef = useRef(L.ui.sel); selRef.current = L.ui.sel;
  const titleRef = useRef(L.byId); titleRef.current = L.byId;
  const api = useMemo<CarryApi>(() => ({ selected: () => selRef.current, titleOf: (id) => titleRef.current.get(id)?.p.title ?? id, setDrag: B.setDrag, place: B.place, readOnly: B.readOnly }), [B.setDrag, B.place, B.readOnly]);

  const first = groups[0]?.items[0]?.p.id, foc = L.ui.focus && L.byId.has(L.ui.focus) ? L.ui.focus : first;
  const row = (f: Finding) => {
    const at = B.spot.get(f.p.id), draft = at?.draft ? at : undefined;
    return <Row key={f.p.id} f={f} on={L.ui.sel.has(f.p.id)} focus={f.p.id === foc} mvp={mvp.has(f.p.id)} max={max} atWave={draft?.wave.id} atN={draft?.n} drafts={drafts} api={api} onFocus={L.setFocus} onToggle={L.toggle} onOpen={L.openFeature} move={L.move} />;
  };
  // the goal of the page, as Triage says it: an empty Proposed list
  const open = L.rows.filter((f) => f.status === 'proposed' && f.w.band !== 'reserve').length;
  const proposedShown = !L.ui.status.size || L.ui.status.has('proposed'), narrowed = !!(L.ui.lens.size || L.ui.feat.size || L.ui.q || L.ui.wave);
  return (
    <div className="sc-sheet" role="table" aria-label="Findings" {...drop({ wave: null })}>
      <div className="sc-head" role="row">
        <span role="columnheader" className="c-sel"><span className="vh">Selected</span></span>
        <span role="columnheader" className="c-pin"><span className="vh">Lens</span></span>
        <span role="columnheader" className="c-t">Finding · feature · before → expected</span>
        <span role="columnheader" className="c-sc">Score</span>
        <span role="columnheader" className="c-r">Risk</span>
        <span role="columnheader" className="c-s">Size</span>
        <span role="columnheader" className="c-w">Wave</span>
      </div>
      {proposedShown && !open && L.all.length ? <div className="lg-zero" role="status"><b>Inbox zero</b>Nothing proposed{narrowed ? ' under these filters' : ''}. New findings land here as scans propose them.</div> : null}
      {groups.map((g, i) => {
        const rsv = L.reserve.find((r) => r.lens === g.lens);
        return (
          <div key={g.lens} className="sc-sec-c">
            <SectionHead letter={String.fromCharCode(65 + (i % 26))} lens={g.lens} items={g.items} spot={B.spot} L={L} />
            {g.items.map(row)}
            {rsv ? <button type="button" className="sc-rsv" aria-expanded={rsv.open} onClick={() => L.toggleReserve(g.lens)} title="Found, verified and scored, but over the run's cap: filed, not discarded, and not counted as ranked">{rsv.open ? '▾' : '▸'} {rsv.items.length} in reserve</button> : null}
            {rsv?.open ? rsv.items.map(row) : null}
          </div>
        );
      })}
      {!groups.length ? <div className="lg-empty">{L.all.length ? 'No finding matches these filters.' : 'No findings yet. A lens scan proposes them; they appear here as it does.'}</div> : null}
    </div>
  );
}

/** A finding as one line inside a dock bin. */
function DockLine({ id }: { id: string }) {
  const { L, B } = useBacklog(), f = L.byId.get(id);
  const selRef = useRef(L.ui.sel); selRef.current = L.ui.sel;
  const api: CarryApi = { selected: () => selRef.current, titleOf: () => f?.p.title ?? id, setDrag: B.setDrag, place: B.place, readOnly: B.readOnly };
  return (
    <li className={'sc-line' + (L.ui.focus === id ? ' focus' : '')} {...carry(api, id)} onClick={() => L.setFocus(id)} title={f?.p.title ?? id}>
      {f ? <Pin lens={f.p.lens} status={f.status} risk={f.p.risk} px={12} /> : null}
      <span>{f?.p.title ?? id}</span>
      {!B.readOnly && B.spot.get(id)?.draft ? <button type="button" className="sc-x" aria-label={'Take ' + (f?.p.title ?? id) + ' out of the wave'} title="Take it out of the wave (0)" onClick={(e) => { e.stopPropagation(); B.place([id], { wave: null }); }}>×</button> : null}
    </li>
  );
}

/** Every wave, always in sight: the drop targets of the sheet, and the one place a wave is edited or dispatched. */
export function WaveDock() {
  const { L, B } = useBacklog();
  return (
    <div className="sc-dock-w" aria-label="Waves" data-wave="strip">
      {L.waves.error ? <p className="sc-warn" role="alert" data-wave="error">The waves could not be read: {L.waves.error} <button type="button" className="sc-all" onClick={L.waves.reload}>Try again</button></p> : null}
      {!L.waves.loaded ? <p className="sc-empty" role="status">Loading waves…</p> : null}
      {B.waves.map((w) => <WaveCard key={w.id} w={w} n={B.drafts.indexOf(w) + 1} renderItem={(id) => <DockLine key={id} id={id} />} />)}
      {B.readOnly ? <p className="sc-empty" data-wave="read-only">Waves are read-only here (BP_WRITES=off).</p> : <NewWave />}
    </div>
  );
}
