'use client';
// What the three directions share: the pin (the plan's marker, same shape and meaning), the score meter, the drag and drop
// wiring, the one-row-and-a-half top bar, and the wave card that reads as a dock card, a tray card or a board column.
import { createContext, useContext, type DragEvent, type ReactNode } from 'react';
import { WAVE_EFFORTS, type Wave, type WavePackage } from '@bp/core/scan/waves';
import type { ProposalStatus } from '@bp/core/scan/types';
import { worthText } from '@bp/core/scan/score';
import { useEngine } from '../../hooks';
import { lensMeta, riskBand, sizeW, type Finding, type Ledger } from '../useLedger';
import { LensGlyph } from '../variants/bits';
import { sharedFeatures } from '../waves/arrange';
import { WaveMark } from '../waves/WavesBar';
import type { Bench, Target } from './bench';
import { LAB_CHOICES, LAB_NAMES, setLabChoice, useLabChoice, type LabChoice } from './choice';

export interface LabCtx { L: Ledger; B: Bench; focusId: string | null; maxScore: number; openBrief(id: string): void }
export const Lab = createContext<LabCtx | null>(null);
export function useLab(): LabCtx {
  const c = useContext(Lab);
  if (!c) throw new Error('useLab outside the lab host');
  return c;
}

// ------------------------------------------------------------------------------------------- marks
const PIN_TONE: Partial<Record<ProposalStatus, string>> = { approved: 'ok', executing: 'run', done: 'dim', accepted: 'dim', released: 'dim', declined: 'dim', descoped: 'dim', failed: 'bad', rework: 'bad' };
/** The plan's marker: a lens glyph on a rounded square, amber to decide, red when the risk is high, a number when a draft holds it. */
export function Pin({ f, n, px = 18, mvp = false }: { f: Finding; n?: number; px?: number; mvp?: boolean }) {
  const P = useEngine().M.P, l = lensMeta(P, f.p.lens);
  const tone = PIN_TONE[f.status] ?? (riskBand(f.p.risk) === 'high' ? 'bad' : 'warn');
  return (
    <span className={'lx-pin t-' + tone + (mvp ? ' mvp' : '')} title={l.name} style={{ '--pin': px + 8 + 'px' } as React.CSSProperties}>
      <LensGlyph g={l.glyph} px={px} />
      {n ? <b className="lx-pin-n">{n}</b> : null}
    </span>
  );
}

/** The score as a drawn bar: filled to its share of the page's best, hatched when it is only an estimate. */
export function Meter({ f }: { f: Finding }) {
  const { maxScore } = useLab(), v = f.w.value ?? 0, pct = maxScore > 0 ? Math.max(4, Math.round((v / maxScore) * 100)) : 0;
  return (
    <span className={'lx-meter k-' + f.w.kind} title={f.w.kind === 'est' ? 'A pre-v5 estimate: value per effort' : f.w.kind === 'score' ? 'scan-score/1, stored by the scan' : 'Unscored: impact or effort unknown'}>
      <i style={{ width: pct + '%' }} /><b>{worthText(f.w)}</b>
    </span>
  );
}

/** The stage bar a wing wears on the plan: one finding's status each, in order. */
export function StageBar({ items }: { items: readonly Finding[] }) {
  const open = items.filter((f) => f.status === 'proposed').length, go = items.filter((f) => f.status === 'approved' || f.status === 'executing').length, n = items.length || 1;
  return <span className="lx-stage" aria-hidden="true"><i className="a" style={{ width: (open / n) * 100 + '%' }} /><i className="b" style={{ width: (go / n) * 100 + '%' }} /></span>;
}

// ------------------------------------------------------------------------------------------- carrying
let ghost: HTMLElement | null = null;
/** A row or pin as a thing to carry: the whole selection if it is part of it, else itself. */
export function useCarry() {
  const { L, B } = useLab();
  return (id: string) => (B.readOnly ? {} : {
    draggable: true,
    onDragStart(e: DragEvent) {
      const ids = L.ui.sel.has(id) ? [...L.ui.sel] : [id];
      e.dataTransfer.setData('text/plain', ids.join(' '));
      e.dataTransfer.effectAllowed = 'move';
      ghost = document.createElement('div');
      ghost.className = 'lx-ghost';
      ghost.textContent = ids.length === 1 ? (L.byId.get(id)?.p.title ?? id) : ids.length + ' findings';
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, 14, 14);
      // changing the DOM inside dragstart cancels the drag in Chromium
      setTimeout(() => { ghost?.remove(); ghost = null; B.setDrag(ids); }, 0);
    },
    onDragEnd() { B.setDrag(null); },
  });
}
/** A place findings can land. The highlight is the element's own class, so a pass over it re-renders nothing. */
export function useDrop() {
  const { B } = useLab();
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

/** The one-press slots on a row: a filled number when a draft holds it, a button per draft wave and a new one otherwise. */
export function Slots({ f }: { f: Finding }) {
  const { L, B } = useLab(), at = B.spot.get(f.p.id);
  if (B.readOnly) return at ? <span className="lx-held">{at.wave.name}</span> : null;
  const ids = L.ui.sel.has(f.p.id) ? [...L.ui.sel] : [f.p.id];
  if (!f.can && !at?.draft) return at ? <span className="lx-held">{at.wave.name}</span> : null;
  return (
    <span className="lx-slots" role="group" aria-label={'Place ' + f.p.title}>
      {B.drafts.slice(0, 9).map((w, i) => {
        const on = at?.draft && at.wave.id === w.id;
        return <button key={w.id} type="button" className={'lx-slot' + (on ? ' on' : '')} aria-pressed={!!on} title={on ? 'In ' + w.name + ' · ' + at!.pkg.name + ': press to take it out' : 'Place in ' + w.name + ' (' + (i + 1) + ')'}
          onClick={(e) => { e.stopPropagation(); B.place(ids, on ? { wave: null } : { wave: w.id }); }}>{i + 1}</button>;
      })}
      <button type="button" className="lx-slot add" title="Start a new wave with this (W)" onClick={(e) => { e.stopPropagation(); B.place(ids, { wave: 'new' }); }}>+</button>
    </span>
  );
}

// ------------------------------------------------------------------------------------------- the top bar
const STATUS_VIEWS: { k: string; label: string; set: ProposalStatus[]; title: string }[] = [
  { k: 'decide', label: 'To decide', set: ['proposed'], title: 'Proposed findings' },
  { k: 'open', label: 'Open', set: ['proposed', 'approved'], title: 'Proposed and approved: what can still go' },
  { k: 'all', label: 'All', set: [], title: 'Every finding, built and declined too' },
];
export function LabSwitch({ onPick }: { onPick?(c: LabChoice): void }) {
  const on = useLabChoice();
  return (
    <div className="lx-switch" role="radiogroup" aria-label="Ledger design direction">
      <span>Lab</span>
      {LAB_CHOICES.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={on === c} className={on === c ? 'on' : ''} title={LAB_NAMES[c].hint} onClick={() => { setLabChoice(c); onPick?.(c); }}>
          {LAB_NAMES[c].key !== '–' ? <b>{LAB_NAMES[c].key}</b> : null}{LAB_NAMES[c].name}
        </button>
      ))}
    </div>
  );
}

const SAVE_WORD = { saved: 'Saved', dirty: 'Saving soon', saving: 'Saving…', failed: 'Not saved' } as const;
export function TopBar({ filter, slots, name }: { filter: React.RefObject<HTMLInputElement | null>; slots: ReactNode; name: string }) {
  const { L, B } = useLab(), E = useEngine(), { ui, set } = L;
  const flip = (id: string) => set((u) => { const s = new Set(u.lens); if (!s.delete(id)) s.add(id); return { ...u, lens: s }; });
  const view = STATUS_VIEWS.find((v) => v.set.length === ui.status.size && v.set.every((s) => ui.status.has(s)))?.k ?? '';
  const pack = L.items.length;
  return (
    <header className="lx-top">
      <div className="lx-row">
        <div className="lx-title"><h2>Findings ledger</h2><span>{name}</span></div>
        <nav className="lx-stations" aria-label="Ledger stages">
          <button type="button" className="on" aria-current="page">Backlog <b>{L.all.length}</b></button>
          <button type="button" onClick={() => L.setScope('packs')} title="Judge what was built (the current design for now)">In packs <b>{pack}</b></button>
          <button type="button" onClick={() => E.setPage('ledger', 'release')} title="Cut the release (the current design for now)">Release</button>
        </nav>
        <span className="lx-sp" />
        <span className={'lx-save s-' + B.save} role="status" title={B.save === 'failed' ? 'The store refused the last change; your edits are still here' : 'Every change saves itself'}>
          <i aria-hidden="true" />{SAVE_WORD[B.save]}
          {B.save === 'failed' ? <button type="button" onClick={B.retry}>Try again</button> : null}
        </span>
        <button type="button" className="lx-undo" disabled={!B.canUndo} onClick={B.undo} title={B.canUndo ? 'Undo: ' + B.said : 'Nothing to undo'}>Undo <kbd>Z</kbd></button>
        {slots}
        <LabSwitch />
      </div>
      <div className="lx-row lx-filt">
        <div className="lx-seg" role="group" aria-label="Which findings">
          {STATUS_VIEWS.map((v) => <button key={v.k} type="button" title={v.title} aria-pressed={view === v.k} onClick={() => set((u) => ({ ...u, status: new Set(v.set) }))}>{v.label}</button>)}
        </div>
        <div className="lx-lenses" role="group" aria-label="Lens">
          {L.lenses.filter((l) => l.n).map((l) => (
            <button key={l.id} type="button" aria-pressed={ui.lens.has(l.id)} title={l.name} onClick={() => flip(l.id)}><LensGlyph g={l.glyph} />{l.short}<b>{l.n}</b></button>
          ))}
        </div>
        <input ref={filter} className="lx-q" type="search" value={ui.q} placeholder="Filter…  /" aria-label="Filter findings by text" onChange={(e) => { const q = e.target.value; set((u) => ({ ...u, q })); }} />
        <span className="lx-sp" />
        <span className="lx-keys"><kbd>J</kbd><kbd>K</kbd> move <kbd>X</kbd> select <kbd>1</kbd>-<kbd>9</kbd> place <kbd>W</kbd> new wave <kbd>Y</kbd> approve <kbd>N</kbd> decline</span>
      </div>
      <span className="vh" aria-live="polite">{B.said}</span>
    </header>
  );
}

// ------------------------------------------------------------------------------------------- the wave
const effortOf = (w: Wave, L: Ledger) => w.packages.flatMap((p) => p.ids).reduce((n, id) => { const f = L.byId.get(id); return n + (f ? sizeW(f.p) : 0); }, 0);
const EFFORT_SHORT: Record<string, string> = { low: 'L', medium: 'M', high: 'H', xhigh: 'X' };

function Pkg({ w, p, form, draft, renderItem }: { w: Wave; p: WavePackage; form: WaveForm; draft: boolean; renderItem(id: string, p: WavePackage): ReactNode }) {
  const { B } = useLab(), drop = useDrop(), one = w.packages.length === 1;
  return (
    <li className="lx-pk" {...(draft ? drop({ wave: w.id, pkg: p.id }) : {})} data-wave-pkg={p.name}>
      <div className="lx-pk-h">
        {draft ? <input className="lx-in lx-pkname" value={p.name} maxLength={60} aria-label="Package name" onChange={(e) => B.patchPkg(w.id, p.id, { name: e.target.value })} /> : <b className="lx-pk-n">{p.name}</b>}
        {draft ? (
          <>
            <button type="button" className="lx-tog" title={'Model: ' + p.model + ' (press to change)'} onClick={() => B.patchPkg(w.id, p.id, { model: p.model === 'opus' ? 'sonnet' : 'opus' })}>{p.model}</button>
            <span className="lx-eff" role="group" aria-label="Effort">
              {WAVE_EFFORTS.map((x, i) => <button key={x} type="button" title={'Effort ' + x} aria-pressed={p.effort === x} className={WAVE_EFFORTS.indexOf(p.effort) >= i ? 'lit' : ''} onClick={() => B.patchPkg(w.id, p.id, { effort: x })}><span className="vh">{x}</span></button>)}
              <em>{EFFORT_SHORT[p.effort]}</em>
            </span>
            {!one ? <button type="button" className="lx-x" title="Remove the package; its findings join the first" aria-label={'Remove package ' + p.name} onClick={() => B.removePkg(w.id, p.id)}>×</button> : null}
          </>
        ) : <span className="lx-tagline">{p.model} · {p.effort}</span>}
      </div>
      {p.ids.length ? <ul className={'lx-items f-' + form}>{p.ids.map((id) => renderItem(id, p))}</ul> : <p className="lx-empty">Drop findings here</p>}
    </li>
  );
}

export type WaveForm = 'dock' | 'tray' | 'column';
/** A wave: its name, state and effort, its packages as drop bins, Dispatch. `renderItem` is how the direction draws a finding in it. */
export function WaveCard({ w, n, form, renderItem, onHover, active }: { w: Wave; n: number; form: WaveForm; renderItem(id: string, p: WavePackage): ReactNode; onHover?(id: string | null): void; active?: boolean }) {
  const { L, B } = useLab(), drop = useDrop(), draft = w.status === 'draft' && !B.readOnly;
  const shown = L.waves.states.get(w.id) ?? 'draft';
  const left = B.readOnly ? 0 : w.packages.flatMap((p) => p.ids).filter((id) => L.byId.get(id)?.can).length, size = w.packages.reduce((k, p) => k + p.ids.length, 0);
  const clash = sharedFeatures(w.packages, L.byId);
  return (
    <section className={'lx-wave f-' + form + (draft ? ' draft' : ' sent') + (active ? ' active' : '') + (B.drag && draft ? ' armed' : '')} aria-label={w.name} data-wave={w.id}
      {...(draft ? drop({ wave: w.id }) : {})} onMouseEnter={() => onHover?.(w.id)} onMouseLeave={() => onHover?.(null)}>
      <header className="lx-wave-h">
        <span className={'lx-num' + (draft ? '' : ' sent')}>{draft ? n : <WaveMark state={shown} word={false} />}</span>
        {draft ? <input className="lx-in" value={w.name} maxLength={60} aria-label="Wave name" onChange={(e) => B.renameWave(w.id, e.target.value)} /> : <b className="lx-wave-n">{w.name}</b>}
        <span className="lx-wave-m" title="Findings · effort (XS 1, S 2, M 3, L 5, XL 8)">{size}<i>·</i>{effortOf(w, L)}</span>
        {draft ? <button type="button" className="lx-x" title="Delete this draft (Z brings it back)" aria-label={'Delete ' + w.name} onClick={() => B.deleteWave(w.id)}>×</button> : null}
      </header>
      <ul className="lx-pks">{w.packages.map((p) => <Pkg key={p.id} w={w} p={p} form={form} draft={draft} renderItem={renderItem} />)}</ul>
      {clash.length ? <p className="lx-warn" title="They build in parallel in one repo and may collide">Packages share {clash[0].name}{clash.length > 1 ? ' +' + (clash.length - 1) : ''}</p> : null}
      <footer className="lx-wave-f">
        {draft ? (
          <>
            <span className="lx-arr" role="group" aria-label="Arrange into packages">
              <button type="button" onClick={() => B.arrangeWave(w.id, 'one')} title="Every finding in one package">One</button>
              <button type="button" onClick={() => B.arrangeWave(w.id, 'feature')} title="One package per feature: no two build the same feature">Feature</button>
              <button type="button" onClick={() => B.arrangeWave(w.id, 'lens')} title="One package per lens">Lens</button>
              <button type="button" onClick={() => B.addPkg(w.id)} title="Add an empty package" aria-label="Add a package" {...drop({ wave: w.id, pkg: 'new' })}>+</button>
            </span>
            <span className="lx-sp" />
          </>
        ) : <span className="lx-sp" />}
        {left ? <button type="button" className="bt go" disabled={L.busy} data-wave="dispatch" title="Save, approve the proposed findings and queue one execute job per package" onClick={() => void B.dispatch(w.id)}>{draft ? 'Dispatch ' + left : 'Dispatch remaining ' + left}</button> : null}
      </footer>
    </section>
  );
}

/** Where a wave is born: drop on it, or press it with a selection. */
export function NewWave({ form }: { form: WaveForm }) {
  const { L, B } = useLab(), drop = useDrop();
  if (B.readOnly) return null;
  const n = L.waveReady.length;
  return (
    <button type="button" className={'lx-newwave f-' + form + (B.drag ? ' armed' : '')} data-wave="new" {...drop({ wave: 'new' })} disabled={!n && !B.drag}
      title={n ? 'A new draft wave with the ' + n + ' selected' : 'Drop findings here, or select some first'} onClick={() => { if (n) B.place(L.waveReady.map((f) => f.p.id), { wave: 'new' }); }}>
      <b aria-hidden="true">+</b>{n ? 'New wave with ' + n + ' selected' : B.drag ? 'Drop for a new wave' : 'Drop here for a new wave'}
    </button>
  );
}

/** A finding as one line inside a dock or tray bin. */
export function Line({ id, p }: { id: string; p: WavePackage }) {
  const { L, B, focusId } = useLab(), carry = useCarry(), f = L.byId.get(id);
  return (
    <li key={id} className={'lx-line' + (focusId === id ? ' focus' : '')} {...carry(id)} onClick={() => L.setFocus(id)} title={(f?.p.title ?? id) + ' · ' + p.name}>
      {f ? <Pin f={f} px={12} /> : null}
      <span>{f?.p.title ?? id}</span>
      {!B.readOnly && B.spot.get(id)?.draft ? <button type="button" className="lx-x" aria-label={'Take ' + (f?.p.title ?? id) + ' out of the wave'} title="Take it out of the wave" onClick={(e) => { e.stopPropagation(); B.place([id], { wave: null }); }}>×</button> : null}
    </li>
  );
}
