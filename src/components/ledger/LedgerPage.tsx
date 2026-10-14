'use client';
// The findings ledger: a full page over the plan area, on the same route (the header's "drawing set | findings
// ledger" switch, or L), so the engine, the live stream and running scans stay alive behind it. Every finding of
// every lens in one place for quick select-and-dispatch across lenses, in two views over one model (useLedger.ts)
// that work as a pair: the Feature × lens matrix shows where findings sit and picks them by area (a cell, a row), the
// Triage table reads and decides them one by one. The selection and the filters are shared, so a pick in the matrix
// is the table's selection; a matrix row's Table (or Enter) opens the table on that feature alone, a removable chip.
// (The owner kept these two of four prototypes on 2026-10-14; the status board and the impact queue are gone.)
//
// Layout: the header stays (the switch, the project, the lens tabs); the page covers the rail and the timeline,
// which act on the plan (fly, scrub, open a flyout) and have nothing to say about a list, and it gets the full
// width the triage table needs. The chrome it covers is inert while it shows (Tab never lands behind it); the toast
// stays reachable above it. Opaque paper, no backdrop-filter over the live canvas (docs/perf.md).
//
// Keys while the page has focus (it owns them: `data-keys="own"`, so the engine's plan keys stay out): J/K or the
// arrows move, Space or X selects, D dispatches the selection, A dispatches the focused finding, Enter opens its
// feature (on a matrix row: that feature in the table), / filters, 1-2 switch the view, Esc clears the selection
// (with none: back to the drawing set).
// On a phone the page is the triage list alone (Phone.tsx hosts it with `phone`).
//
// Lens actions: each lens chip has a disclosure (▾) with Scan this lens, Scan selection, Execute backlog (n) and Open in
// Lenses panel; with a selection the top bar offers "Scan selected features" (a picker of scannable lenses, one
// selection scan each). Both go through lens/lens-ops.ts, as the Lenses panel does.
//
// Mount: `<LedgerPage lensButton={<LensesButton />} lensPanel={<LensesPanel />} />` in BlueprintApp's Chrome
// (it renders nothing unless the store's `page` is 'ledger'); the slots take the Lenses button and panel.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { LEDGER_VARIANTS, type LedgerVariant } from '@/engine/state';
import type { ProposalStatus } from '@/lib/scan/types';
import { useProductName } from '@/lib/scan/projects';
import { MAX_SELECTION } from '@/lib/scan/jobs';
import { shallowEqual, useBp, useEngine, useLive, useScanCtx } from '../hooks';
import { STATUSES, setLedgerUi, useLedger, useLedgerSelection, useLedgerUi, type Ledger, type LedgerUi, type LensCol, type SetUi } from './useLedger';
import { DispatchBar, LensGlyph } from './variants/bits';
import { EXEC_BATCH, executeAsk, executeBacklog, scanBlock, scanNow, scanSelection, useLensRows, useLensStats } from './lens/lens-ops';
import { setLensesPanelOpen } from './lens/LensesPanel';
import { Triage } from './variants/Triage';
import { Matrix } from './variants/Matrix';
import './ledger.css';

export interface LedgerPageProps {
  /** The "Lenses" button (LensesButton), shown in the top bar. */
  lensButton?: ReactNode;
  /** The Lenses panel (LensesPanel), shown beside the ledger's body; it renders nothing while closed. */
  lensPanel?: ReactNode;
  /** The phone view hosts the ledger: triage only, in the page flow. */
  phone?: boolean;
}

const NAMES: Record<LedgerVariant, string> = { triage: 'Triage table', matrix: 'Feature × lens matrix' };

/** Mounted always (cheap: one store slice); the page state is useLedger.ts's store, so the selection and filters outlive a close. */
export function LedgerPage({ lensButton, lensPanel, phone = false }: LedgerPageProps) {
  const s = useBp((s) => ({ page: s.page, lv: s.lv, phone: s.phone }), shallowEqual);
  const ui = useLedgerUi(useLive()?.slug ?? 'kettle'), set: SetUi = setLedgerUi;
  const shown = s.page === 'ledger' && s.phone === phone;
  if (phone) return shown ? <Body ui={ui} set={set} lv="triage" phone lensButton={null} lensPanel={null} /> : null;
  // no exit animation: leaving unmounts at once, so the chrome it made inert is released in the same commit that a
  // feature page (opened from a row) takes it over
  return shown ? <Body ui={ui} set={set} lv={s.lv} phone={false} lensButton={lensButton} lensPanel={lensPanel} /> : null;
}

const isTyping = (t: HTMLElement) => (t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'checkbox') || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
const isControl = (t: HTMLElement) => !!t.closest('button, a, summary, input, select, textarea');

function Body({ ui, set, lv, phone, lensButton, lensPanel }: { ui: LedgerUi; set: SetUi; lv: LedgerVariant; phone: boolean; lensButton: ReactNode; lensPanel: ReactNode }) {
  const E = useEngine(), L = useLedger(ui, set), live = useLive();
  const name = useProductName(E.M.live?.slug ?? null, E.M.P.name);
  const root = useRef<HTMLElement>(null), filter = useRef<HTMLInputElement>(null);

  // the chrome behind (rail, timeline, plan overlays, the canvas) is inert while the page shows; the header and toast are not
  useLayoutEffect(() => {
    if (phone) return;
    const page = root.current, host = page?.closest('.bp');
    const held: HTMLElement[] = [];
    host?.querySelectorAll<HTMLElement>('.bp-map, .bp-ui > *').forEach((el) => {
      if (el === page || el.contains(page!) || el.id === 'hdr' || el.id === 'toast' || el.classList.contains('toast-live')) return;
      if (!el.inert) { el.inert = true; held.push(el); }
    });
    page?.focus({ preventScroll: true });
    return () => {
      for (const el of held) el.inert = false;
      const at = document.activeElement;
      if (!at || at === document.body || page?.contains(at)) host?.querySelector<HTMLElement>('.bp-map')?.focus({ preventScroll: true });
    };
  }, [phone]);

  // a render that removes the focused element (a view switch, the matrix's Table, a filter chip that goes, a row that
  // filters out) drops focus to the body, where the page's keys stop until a click: it comes back to the page. One
  // activeElement read per render; focus held anywhere else (the header, the lens panel, the toast) is left alone.
  useEffect(() => {
    const page = root.current, at = document.activeElement;
    if (page && (!at || at === document.body)) page.focus({ preventScroll: true });
  });

  // keyboard focus follows the focused finding (J/K); the element is found by its data-fid
  const focusEl = (id: string) => requestAnimationFrame(() => {
    const el = root.current?.querySelector<HTMLElement>('[data-fid="' + CSS.escape(id) + '"]');
    el?.focus({ preventScroll: true }); el?.scrollIntoView({ block: 'nearest' });
  });
  const current = (): string | null => { const ord = L.order(lv); return ui.focus && ord.includes(ui.focus) ? ui.focus : ord[0] ?? null; };
  const step = (d: number) => {
    const ord = L.order(lv); if (!ord.length) return;
    const i = ui.focus ? ord.indexOf(ui.focus) : -1, j = i < 0 ? 0 : Math.max(0, Math.min(ord.length - 1, i + d));
    L.setFocus(ord[j]); focusEl(ord[j]);
  };
  /** The findings a focus id stands for: one, or a matrix row's. */
  const under = (id: string | null): string[] => !id ? [] : id.startsWith('feat:') ? L.rows.filter((f) => 'feat:' + f.p.feature === id).map((f) => f.p.id) : [id];

  const onKey = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement, k = e.key;
    if (isTyping(t)) {
      if (k === 'Escape') { e.preventDefault(); if (ui.q) set((u) => ({ ...u, q: '' })); else root.current?.focus(); }
      return;
    }
    if (t.closest('.lg-side, .lg-pop')) return; // the Lenses panel and the lens menus keep their own keys
    const ctl = isControl(t);
    if (k === 'Escape') { e.preventDefault(); if (ui.sel.size) L.clear(); else E.setPage('plan'); return; }
    if (k === 'j' || k === 'J' || k === 'ArrowDown') { e.preventDefault(); step(1); return; }
    if (k === 'k' || k === 'K' || k === 'ArrowUp') { e.preventDefault(); step(-1); return; }
    if ((k === ' ' && !ctl) || k === 'x' || k === 'X') { e.preventDefault(); const ids = under(current()); if (ids.length) L.select(ids); return; }
    if (k === 'd' || k === 'D') { e.preventDefault(); void L.dispatchIds(); return; }
    if (k === 'a' || k === 'A') { e.preventDefault(); void L.dispatchIds(under(current())); return; }
    if (k === 'Enter' && !ctl) {
      const id = current();
      if (id?.startsWith('feat:')) { e.preventDefault(); L.showInTable(id.slice(5)); return; }
      const f = L.byId.get(id ?? ''); if (f) { e.preventDefault(); L.openFeature(f); } return;
    }
    if (k === '/') { e.preventDefault(); filter.current?.focus(); return; }
    if (!phone && /^[1-2]$/.test(k)) { e.preventDefault(); E.setPage('ledger', LEDGER_VARIANTS[+k - 1]); }
  };

  const view = lv === 'matrix' ? <Matrix L={L} /> : <Triage L={L} />;
  const inner = (
    <>
      <header className="lg-top">
        <div className="lg-h">
          <h2>Findings ledger</h2>
          <span className="lg-prod">{name} · {live ? 'live lens scan' : 'sample findings, simulated execution'} · {L.all.length} findings</span>
        </div>
        {!phone && (
          <div className="lg-tabs" role="tablist" aria-label="Ledger views">
            {LEDGER_VARIANTS.map((k, i) => (
              <button key={k} type="button" role="tab" aria-selected={lv === k} className={lv === k ? 'on' : ''} onClick={() => E.setPage('ledger', k)} title={NAMES[k] + ' (' + (i + 1) + ')'}>
                {NAMES[k]}<kbd>{i + 1}</kbd>
              </button>
            ))}
          </div>
        )}
        {!phone && ui.sel.size ? <SelScan L={L} /> : null}
        {lensButton ? <div className="lg-slot">{lensButton}</div> : null}
      </header>
      <Filters L={L} filter={filter} menus={!phone} />
      <div className="lg-main">
        <div className="lg-body" role={phone ? undefined : 'tabpanel'} aria-label={NAMES[lv]}>{view}</div>
        {lensPanel ? <aside className="lg-side" aria-label="Lenses">{lensPanel}</aside> : null}
      </div>
      <DispatchBar L={L} />
    </>
  );
  if (phone) return <section ref={root} className="lg-page phone" aria-label="Findings ledger" tabIndex={-1} onKeyDown={onKey}>{inner}</section>;
  return (
    <motion.section ref={root} className="lg-page" aria-label="Findings ledger" tabIndex={-1} data-keys="own" onKeyDown={onKey}
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24, ease: [0.2, 0.7, 0.2, 1] }}>
      {inner}
    </motion.section>
  );
}

/** Status chips (they carry the counts), lens chips (glyph, short, count), the matrix's feature drill-down and the text filter. */
function Filters({ L, filter, menus }: { L: Ledger; filter: React.RefObject<HTMLInputElement | null>; menus: boolean }) {
  const { ui, set } = L;
  const flip = <T,>(xs: ReadonlySet<T>, x: T) => { const s = new Set(xs); if (!s.delete(x)) s.add(x); return s; };
  const any = ui.lens.size || ui.status.size || ui.feat.size || ui.q;
  return (
    <div className="lg-filt">
      <div className="lg-chips" role="group" aria-label="Status">
        {STATUSES.map((st: ProposalStatus) => <button key={st} type="button" className={'lg-chip s-' + st} aria-pressed={ui.status.has(st)} onClick={() => set((u) => ({ ...u, status: flip(u.status, st) }))}>{st}<b>{L.counts[st]}</b></button>)}
      </div>
      <div className="lg-chips" role="group" aria-label="Lens">
        {L.lenses.filter((l) => l.n).map((l) => (
          <span key={l.id} className="lg-lchip">
            <button type="button" className="lg-chip" aria-pressed={ui.lens.has(l.id)} title={l.name} onClick={() => set((u) => ({ ...u, lens: flip(u.lens, l.id) }))}>
              <LensGlyph g={l.glyph} />{l.short}<b>{l.n}</b>
            </button>
            {menus ? <LensMenu l={l} /> : null}
          </span>
        ))}
      </div>
      {ui.feat.size ? (
        <div className="lg-chips" role="group" aria-label="Feature">
          {[...ui.feat].map((slug) => (
            <button key={slug} type="button" className="lg-chip lg-fchip" aria-pressed="true" title="Show every feature again" onClick={() => set((u) => { const s = new Set(u.feat); s.delete(slug); return { ...u, feat: s }; })}>
              feature {L.all.find((f) => f.p.feature === slug)?.fname ?? slug}<span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
      ) : null}
      <input ref={filter} className="lg-q" type="search" value={ui.q} placeholder="Filter findings…  /" aria-label="Filter findings by text" onChange={(e) => { const q = e.target.value; set((u) => ({ ...u, q })); }} />
      {any ? <button type="button" className="lg-x" onClick={() => set((u) => ({ ...u, lens: new Set(), status: new Set(), feat: new Set(), q: '' }))}>Clear filters</button> : null}
    </div>
  );
}

// ------------------------------------------------------------------------------------------- lens menus
/** A small panel a button opens under itself: Esc or a click outside closes it (Esc gives focus back to the button),
 *  focus leaving it closes it, the arrows move between its controls. The page's keys stay out (`.lg-pop`). */
function usePop() {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null), box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    box.current?.querySelector<HTMLElement>('button:not([aria-disabled="true"]), input')?.focus({ preventScroll: true });
    const down = (e: PointerEvent) => { const t = e.target as Node; if (!box.current?.contains(t) && !btn.current?.contains(t)) setOpen(false); };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  }, [open]);
  const close = () => { setOpen(false); btn.current?.focus({ preventScroll: true }); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const els = Array.from(box.current?.querySelectorAll<HTMLElement>('button, input') ?? []);
    const i = els.indexOf(document.activeElement as HTMLElement), n = els.length;
    if (!n) return;
    e.preventDefault(); e.stopPropagation();
    els[(i + (e.key === 'ArrowDown' ? 1 : -1) + n) % n]?.focus();
  };
  const onBlur = (e: React.FocusEvent) => { const t = e.relatedTarget as Node | null; if (t && !box.current?.contains(t) && !btn.current?.contains(t)) setOpen(false); };
  return { open, setOpen, btn, box, close, onKey, onBlur };
}

/** The disclosure next to a lens chip: Scan this lens, Scan selection, Execute backlog (n), Open in Lenses panel. */
function LensMenu({ l }: { l: LensCol }) {
  const pop = usePop();
  return (
    <>
      <button ref={pop.btn} type="button" className="lg-chip lg-chipm" aria-haspopup="true" aria-expanded={pop.open} aria-label={'Actions for ' + l.name}
        title={'Scan or execute ' + l.name} onClick={() => pop.setOpen(!pop.open)}>
        <span aria-hidden="true">▾</span>
      </button>
      {pop.open ? (
        <div ref={pop.box} className="lg-pop" role="group" aria-label={l.name + ' actions'} data-keys="own" onKeyDown={pop.onKey} onBlur={pop.onBlur}>
          <LensMenuBody l={l} close={pop.close} />
        </div>
      ) : null}
    </>
  );
}

function LensMenuBody({ l, close }: { l: LensCol; close: () => void }) {
  const E = useEngine(), ctx = useScanCtx(), { rows } = useLensRows(), stat = useLensStats().get(l.id), sel = useLedgerSelection();
  const [ask, setAsk] = useState(false);
  const r = rows.find((x) => x.id === l.id);
  const block = r ? scanBlock(r, !!ctx.sim) : 'This map has no lens ' + l.id;
  const selBlock = block ?? (sel.features.length ? null : 'Select findings in the ledger first');
  const n = stat.backlog, exBlock = !r ? block : n ? null : 'Nothing to build: no proposed or approved finding without a job';
  const item = (label: string, why: string | null, go: () => void, extra?: string) => (
    <button type="button" className="lg-mi" aria-disabled={why ? true : undefined} title={why ?? undefined} onClick={() => { if (!why) go(); }}>
      <span>{label}</span>{why ? <small>{why}</small> : extra ? <small>{extra}</small> : null}
    </button>
  );
  if (ask) return (
    <div className="lg-ask" role="group" aria-label={'Execute the ' + l.name + ' backlog'}>
      <p>{executeAsk(n)}</p>
      <div>
        <button type="button" className="bt go" onClick={() => { close(); void executeBacklog(E, ctx, l.id, l.name); }}>Build {n}</button>
        <button type="button" className="bt" onClick={() => setAsk(false)}>Keep</button>
      </div>
    </div>
  );
  return (
    <>
      <div className="lg-pop-h"><LensGlyph g={l.glyph} />{l.name}</div>
      {item('Scan this lens · everything', block, () => { close(); void scanNow(E, ctx, l.id, l.name); })}
      {item('Scan selection', selBlock, () => { close(); void scanSelection(E, ctx, [{ id: l.id, name: l.name }], sel.features); },
        sel.features.length ? sel.features.length + (sel.features.length === 1 ? ' feature' : ' features') + (sel.features.length > MAX_SELECTION ? ', the first ' + MAX_SELECTION : '') : undefined)}
      {item('Execute backlog (' + n + ')', exBlock, () => setAsk(true), n > EXEC_BATCH ? 'in jobs of ' + EXEC_BATCH : undefined)}
      {item('Open in Lenses panel', null, () => { close(); setLensesPanelOpen(true, l.id); })}
    </>
  );
}

/** "Scan selected features": a picker of scannable lenses (default: the lenses of the selected findings), one
 *  selection scan per chosen lens over the features behind the selection. */
function SelScan({ L }: { L: Ledger }) {
  const pop = usePop();
  return (
    <div className="lg-selscan">
      <button ref={pop.btn} type="button" className="bt" aria-haspopup="true" aria-expanded={pop.open} onClick={() => pop.setOpen(!pop.open)}
        title="Measure the features behind the selected findings with the lenses you pick">Scan selected features</button>
      {pop.open ? (
        <div ref={pop.box} className="lg-pop end" role="group" aria-label="Scan selected features" data-keys="own" onKeyDown={pop.onKey} onBlur={pop.onBlur}>
          <SelScanBody L={L} close={pop.close} />
        </div>
      ) : null}
    </div>
  );
}

function SelScanBody({ L, close }: { L: Ledger; close: () => void }) {
  const E = useEngine(), ctx = useScanCtx(), { rows } = useLensRows(), sel = useLedgerSelection();
  const ok = rows.filter((r) => !scanBlock(r, !!ctx.sim));
  const [pick, setPick] = useState<ReadonlySet<string>>(() => { const d = sel.lenses.filter((id) => ok.some((r) => r.id === id)); return new Set(d.length ? d : []); });
  const meta = (id: string) => L.lenses.find((c) => c.id === id);
  const fs = sel.features.length, go = ok.filter((r) => pick.has(r.id));
  return (
    <>
      <div className="lg-pop-h">{fs} {fs === 1 ? 'feature' : 'features'} behind {sel.n} {sel.n === 1 ? 'finding' : 'findings'}</div>
      {fs > MAX_SELECTION ? <p className="lg-pop-n">A selection scan takes at most {MAX_SELECTION} features: the first {MAX_SELECTION} in map order go.</p> : null}
      {!fs ? <p className="lg-pop-n">The selected findings name no feature of this map.</p> : null}
      <fieldset className="lg-picks">
        <legend>Lenses</legend>
        {ok.length ? ok.map((r) => (
          <label key={r.id}>
            <input type="checkbox" checked={pick.has(r.id)} onChange={() => setPick((p) => { const s = new Set(p); if (!s.delete(r.id)) s.add(r.id); return s; })} />
            {meta(r.id) ? <LensGlyph g={meta(r.id)!.glyph} /> : null}{r.manifest.name}
          </label>
        )) : <p className="lg-pop-n">No lens can be scanned here.</p>}
      </fieldset>
      <div className="lg-pop-a">
        <button type="button" className="bt go" disabled={!go.length || !fs} onClick={() => { close(); void scanSelection(E, ctx, go.map((r) => ({ id: r.id, name: r.manifest.name })), sel.features); }}>
          {go.length === 1 ? 'Start 1 scan' : 'Start ' + go.length + ' scans'}
        </button>
        <button type="button" className="bt" onClick={close}>Cancel</button>
      </div>
    </>
  );
}
