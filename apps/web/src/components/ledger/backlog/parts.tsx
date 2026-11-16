'use client';
// The Backlog's shared parts: the pin (the plan's marker, same shape and meaning), the score meter, the drag and drop wiring,
// the wave slots, the bench's save state and the wave card of the dock. Row-level parts take plain props, so a J/K step
// re-renders the two rows involved (useBacklog is for the dock and the bars, which change with the waves anyway).
import { createContext, memo, useContext, type DragEvent, type ReactNode } from 'react';
import { WAVE_EFFORTS, type Wave, type WavePackage } from '@bp/core/scan/waves';
import type { ProposalStatus } from '@bp/core/scan/types';
import { worthText } from '@bp/core/scan/score';
import { useEngine } from '../../hooks';
import { lensMeta, riskBand, sizeW, type Finding, type Ledger } from '../useLedger';
import { LensGlyph } from '../variants/bits';
import { sharedFeatures } from '../waves/arrange';
import { WaveMark } from '../waves/WavesBar';
import type { Bench, Target } from './bench';

export interface BacklogCtx { L: Ledger; B: Bench }
export const Backlog = createContext<BacklogCtx | null>(null);
export function useBacklog(): BacklogCtx {
  const c = useContext(Backlog);
  if (!c) throw new Error('useBacklog outside the ledger page');
  return c;
}

// ------------------------------------------------------------------------------------------- marks
const PIN_TONE: Partial<Record<ProposalStatus, string>> = { approved: 'ok', executing: 'run', done: 'dim', accepted: 'dim', released: 'dim', declined: 'dim', descoped: 'dim', failed: 'bad', rework: 'bad' };
/** The plan's marker: a lens glyph on a rounded square, amber to decide, red when the risk is high, a number when a draft holds it. */
export const Pin = memo(function Pin({ lens, status, risk, n, px = 18, mvp = false }: { lens: string; status: ProposalStatus; risk: number | undefined; n?: number | undefined; px?: number; mvp?: boolean }) {
  const P = useEngine().M.P, l = lensMeta(P, lens);
  const tone = PIN_TONE[status] ?? (riskBand(risk) === 'high' ? 'bad' : 'warn');
  return (
    <span className={'sc-pin t-' + tone + (mvp ? ' mvp' : '')} title={l.name + (mvp ? ' · the lens MVP' : '')} style={{ '--pin': px + 8 + 'px' } as React.CSSProperties}>
      <LensGlyph g={l.glyph} px={px} />
      {n ? <b className="sc-pin-n">{n}</b> : null}
    </span>
  );
});

/** The score as a drawn bar: filled to its share of the page's best, hatched when it is only an estimate. */
export function Meter({ f, max }: { f: Finding; max: number }) {
  const v = f.w.value ?? 0, pct = max > 0 && v > 0 ? Math.max(4, Math.round((v / max) * 100)) : 0, p = f.p;
  const sub = [p.impact !== undefined ? 'impact ' + p.impact : '', p.confidence ?? ''].filter(Boolean).join(' · ');
  const why = f.w.kind === 'est' ? 'A pre-v5 estimate: value per effort' : f.w.kind === 'score' ? 'scan-score/1, stored by the scan' : 'Unscored: impact or effort unknown';
  return <span className={'sc-meter k-' + f.w.kind} title={why + (sub ? ' · ' + sub : '') + (p.impact_why ? ' · ' + p.impact_why : '')}><i style={{ width: pct + '%' }} /><b>{worthText(f.w)}</b></span>;
}

/** The stage bar a wing wears on the plan: how much of a section waits to be decided, and how much is moving. */
export function StageBar({ items }: { items: readonly Finding[] }) {
  const open = items.filter((f) => f.status === 'proposed').length, go = items.filter((f) => f.status === 'approved' || f.status === 'executing').length, n = items.length || 1;
  return <span className="sc-stage" aria-hidden="true"><i className="a" style={{ width: (open / n) * 100 + '%' }} /><i className="b" style={{ width: (go / n) * 100 + '%' }} /></span>;
}

// ------------------------------------------------------------------------------------------- carrying
/** What a carried row needs: stable across renders, so it can sit in a memoised row's props. */
export interface CarryApi { selected(): ReadonlySet<string>; titleOf(id: string): string; setDrag(ids: readonly string[] | null): void; place(ids: readonly string[], to: Target): void; readOnly: boolean }
let ghost: HTMLElement | null = null;
/** A row as a thing to carry: the whole selection if it is part of it, else itself; `whole` names what a matrix cell holds. */
export const carry = (api: CarryApi, id: string, whole?: readonly string[]) => (api.readOnly ? {} : {
  draggable: true,
  onDragStart(e: DragEvent) {
    const sel = api.selected(), ids = whole ? [...whole] : sel.has(id) ? [...sel] : [id];
    e.dataTransfer.setData('text/plain', ids.join(' '));
    e.dataTransfer.effectAllowed = 'move';
    ghost = document.createElement('div');
    ghost.className = 'sc-ghost';
    ghost.textContent = ids.length === 1 ? api.titleOf(id) : ids.length + ' findings';
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 14, 14);
    // changing the DOM inside dragstart cancels the drag in Chromium
    setTimeout(() => { ghost?.remove(); ghost = null; api.setDrag(ids); }, 0);
  },
  onDragEnd() { api.setDrag(null); },
});
/** A place findings can land. The highlight is the element's own class, so a pass over it re-renders nothing. */
export function useDrop() {
  const { B } = useBacklog();
  return (to: Target) => (B.readOnly ? {} : {
    onDragOver(e: DragEvent) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; e.currentTarget.classList.add('over'); },
    onDragLeave(e: DragEvent) { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) e.currentTarget.classList.remove('over'); },
    onDrop(e: DragEvent) {
      e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.remove('over');
      const ids = e.dataTransfer.getData('text/plain').split(' ').filter(Boolean);
      B.setDrag(null);
      if (ids.length) B.place(ids, to);
    },
  });
}

/** One press from a row to a wave: a number per draft (filled when it holds the row) and a new one. `drafts` is one string so a memoised row compares it by value. */
export function Slots({ id, title, at, drafts, api, canPlace }: { id: string; title: string; at: string | undefined; drafts: string; api: CarryApi; canPlace: boolean }) {
  if (api.readOnly || !canPlace) return null;
  const list = drafts ? (drafts.split('\n').map((x) => x.split('\t')) as [string, string][]) : [];
  const ids = () => { const s = api.selected(); return s.has(id) ? [...s] : [id]; };
  return (
    <span className="sc-slots" role="group" aria-label={'Place ' + title}>
      {list.slice(0, 9).map(([w, name], i) => {
        const on = at === w;
        return <button key={w} type="button" tabIndex={-1} className={'sc-slot' + (on ? ' on' : '')} aria-pressed={on} title={on ? 'In ' + name + ': press to take it out' : 'Place in ' + name + ' (' + (i + 1) + ')'}
          onClick={(e) => { e.stopPropagation(); api.place(ids(), on ? { wave: null } : { wave: w }); }}>{i + 1}</button>;
      })}
      <button type="button" tabIndex={-1} className="sc-slot add" title="Start a new wave with this (+)" onClick={(e) => { e.stopPropagation(); api.place(ids(), { wave: 'new' }); }}>+</button>
    </span>
  );
}

// ------------------------------------------------------------------------------------------- the bars
const SAVE_WORD = { saved: 'Saved', dirty: 'Saving soon', saving: 'Saving…', failed: 'Not saved' } as const;
/** Whether the wave work is safe, always in sight, and the way back. */
export function BenchStatus() {
  const { B } = useBacklog();
  if (B.readOnly) return null;
  return (
    <>
      <span className={'sc-save s-' + B.save} role="status" title={B.save === 'failed' ? 'The store refused the last change; your edits are still here' : 'Every wave change saves itself'}>
        <i aria-hidden="true" />{SAVE_WORD[B.save]}
        {B.save === 'failed' ? <button type="button" onClick={B.retry}>Try again</button> : null}
      </span>
      <button type="button" className="sc-undo" disabled={!B.canUndo} onClick={B.undo} title={B.canUndo ? 'Undo: ' + B.said : 'No wave change to undo'}>Undo <kbd>Z</kbd></button>
      <span className="vh" aria-live="polite">{B.said}</span>
    </>
  );
}

/** The dispatch bar's way to a wave: the selection goes to a draft, by number, or into a new one. */
export function PlaceBar() {
  const { L, B } = useBacklog(), ids = L.ready.map((f) => f.p.id);
  if (B.readOnly) return null;
  return (
    <span className="sc-placebar" role="group" aria-label="Place the selection">
      {B.drafts.slice(0, 9).map((w, i) => <button key={w.id} type="button" className="sc-slot big" disabled={!ids.length} title={'Place the selection in ' + w.name + ' (' + (i + 1) + ')'} onClick={() => B.place(ids, { wave: w.id })}>{i + 1}</button>)}
      <button type="button" className="bt" data-wave="add" disabled={!ids.length} title={ids.length ? 'A new draft wave with these (+)' : 'Select proposed or approved findings that no job is building'} onClick={() => B.place(ids, { wave: 'new' })}>New wave</button>
    </span>
  );
}

// ------------------------------------------------------------------------------------------- the wave
const effortOf = (w: Wave, L: Ledger) => w.packages.flatMap((p) => p.ids).reduce((n, id) => { const f = L.byId.get(id); return n + (f ? sizeW(f.p) : 0); }, 0);
const EFFORT_SHORT: Record<string, string> = { low: 'L', medium: 'M', high: 'H', xhigh: 'X' };

function Pkg({ w, p, draft, renderItem }: { w: Wave; p: WavePackage; draft: boolean; renderItem(id: string, p: WavePackage): ReactNode }) {
  const { B } = useBacklog(), drop = useDrop(), one = w.packages.length === 1;
  return (
    <li className="sc-pk" {...(draft ? drop({ wave: w.id, pkg: p.id }) : {})} data-wave-pkg={p.name}>
      <div className="sc-pk-h">
        {draft ? <input className="sc-in sc-pkname" value={p.name} maxLength={60} aria-label="Package name" onChange={(e) => B.patchPkg(w.id, p.id, { name: e.target.value })} /> : <b className="sc-pk-n">{p.name}</b>}
        {draft ? (
          <>
            <button type="button" className="sc-tog" title={'Model: ' + p.model + ' (press to change)'} onClick={() => B.patchPkg(w.id, p.id, { model: p.model === 'opus' ? 'sonnet' : 'opus' })}>{p.model}</button>
            <span className="sc-eff" role="group" aria-label="Effort">
              {WAVE_EFFORTS.map((x, i) => <button key={x} type="button" title={'Effort ' + x} aria-pressed={p.effort === x} className={WAVE_EFFORTS.indexOf(p.effort) >= i ? 'lit' : ''} onClick={() => B.patchPkg(w.id, p.id, { effort: x })}><span className="vh">{x}</span></button>)}
              <em>{EFFORT_SHORT[p.effort]}</em>
            </span>
            {!one ? <button type="button" className="sc-x" title="Remove the package; its findings join the first" aria-label={'Remove package ' + p.name} onClick={() => B.removePkg(w.id, p.id)}>×</button> : null}
          </>
        ) : <span className="sc-tagline">{p.model} · {p.effort}</span>}
      </div>
      {p.ids.length ? <ul className="sc-items">{p.ids.map((id) => renderItem(id, p))}</ul> : <p className="sc-empty">Drop findings here</p>}
    </li>
  );
}

/** A wave in the dock: its name, state and effort, its packages as drop bins, Dispatch. Its number filters the sheet to it. */
export function WaveCard({ w, n, renderItem }: { w: Wave; n: number; renderItem(id: string, p: WavePackage): ReactNode }) {
  const { L, B } = useBacklog(), drop = useDrop(), draft = w.status === 'draft' && !B.readOnly;
  const shown = L.waves.states.get(w.id) ?? 'draft', filtered = L.ui.wave === w.id;
  const left = B.readOnly ? 0 : w.packages.flatMap((p) => p.ids).filter((id) => L.byId.get(id)?.can).length, size = w.packages.reduce((k, p) => k + p.ids.length, 0);
  const clash = sharedFeatures(w.packages, L.byId);
  return (
    <section className={'sc-wave' + (draft ? ' draft' : ' sent') + (filtered ? ' active' : '') + (B.drag && draft ? ' armed' : '')} aria-label={w.name} data-wave={w.id} {...(draft ? drop({ wave: w.id }) : {})}>
      <header className="sc-wave-h">
        <button type="button" className={'sc-num' + (draft ? '' : ' sent') + (filtered ? ' on' : '')} aria-pressed={filtered} title={(filtered ? 'Show every finding' : 'Show only this wave') + (draft ? ' · its place key is ' + n : '')} onClick={() => L.showWave(filtered ? null : w.id)}>
          {draft ? n : <WaveMark state={shown} word={false} />}
        </button>
        {draft ? <input className="sc-in" value={w.name} maxLength={60} aria-label="Wave name" onChange={(e) => B.renameWave(w.id, e.target.value)} /> : <b className="sc-wave-n">{w.name}</b>}
        <span className="sc-wave-m" title="Findings · effort (XS 1, S 2, M 3, L 5, XL 8)">{size}<i>·</i>{effortOf(w, L)}</span>
        {draft ? <button type="button" className="sc-x" title="Delete this draft (Z brings it back)" aria-label={'Delete ' + w.name} onClick={() => B.deleteWave(w.id)}>×</button> : null}
      </header>
      <ul className="sc-pks">{w.packages.map((p) => <Pkg key={p.id} w={w} p={p} draft={draft} renderItem={renderItem} />)}</ul>
      {clash.length ? <p className="sc-warn" title="They build in parallel in one repo and may collide; one package avoids it">Packages share {clash[0].name}{clash.length > 1 ? ' +' + (clash.length - 1) : ''}</p> : null}
      <footer className="sc-wave-f">
        {draft ? (
          <span className="sc-arr" role="group" aria-label="Arrange into packages">
            <button type="button" onClick={() => B.arrangeWave(w.id, 'one')} title="Every finding in one package">One</button>
            <button type="button" onClick={() => B.arrangeWave(w.id, 'feature')} title="One package per feature: no two build the same feature">Feature</button>
            <button type="button" onClick={() => B.arrangeWave(w.id, 'lens')} title="One package per lens">Lens</button>
            <button type="button" onClick={() => B.addPkg(w.id)} title="Add an empty package" aria-label="Add a package" {...drop({ wave: w.id, pkg: 'new' })}>+</button>
          </span>
        ) : null}
        <span className="sc-sp" />
        {left ? <button type="button" className="bt go" disabled={L.busy} data-wave="dispatch" title="Save, approve the proposed findings and queue one execute job per package" onClick={() => void B.dispatch(w.id)}>{draft ? 'Dispatch ' + left : 'Dispatch remaining ' + left}</button> : null}
      </footer>
    </section>
  );
}

/** Where a wave is born: drop on it, or press it with a selection. */
export function NewWave() {
  const { L, B } = useBacklog(), drop = useDrop();
  if (B.readOnly) return null;
  const n = L.waveReady.length;
  return (
    <button type="button" className={'sc-newwave' + (B.drag ? ' armed' : '')} data-wave="new" {...drop({ wave: 'new' })} disabled={!n && !B.drag}
      title={n ? 'A new draft wave with the ' + n + ' selected' : 'Drop findings here, or select some first'} onClick={() => { if (n) B.place(L.waveReady.map((f) => f.p.id), { wave: 'new' }); }}>
      <b aria-hidden="true">+</b>{n ? 'New wave with ' + n + ' selected' : 'Drop here for a new wave'}
    </button>
  );
}
