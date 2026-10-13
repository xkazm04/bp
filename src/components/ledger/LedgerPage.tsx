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
// Mount: `<LedgerPage lensButton={<TempLensButton />} lensPanel={<TempLensPanel />} />` in BlueprintApp's Chrome
// (it renders nothing unless the store's `page` is 'ledger'); the slots take the temporary-lens button and panel.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { LEDGER_VARIANTS, type LedgerVariant } from '@/engine/state';
import type { ProposalStatus } from '@/lib/scan/types';
import { useProductName } from '@/lib/scan/projects';
import { shallowEqual, useBp, useEngine, useLive } from '../hooks';
import { EMPTY_UI, STATUSES, useLedger, type Ledger, type LedgerUi, type SetUi } from './useLedger';
import { DispatchBar, LensGlyph } from './variants/bits';
import { Triage } from './variants/Triage';
import { Matrix } from './variants/Matrix';
import './ledger.css';

export interface LedgerPageProps {
  /** The "New temporary lens" button (WP6's TempLensButton), shown in the top bar. */
  lensButton?: ReactNode;
  /** The temporary-lens panel (WP6's TempLensPanel), shown beside the ledger's body; it renders nothing while closed. */
  lensPanel?: ReactNode;
  /** The phone view hosts the ledger: triage only, in the page flow. */
  phone?: boolean;
}

const NAMES: Record<LedgerVariant, string> = { triage: 'Triage table', matrix: 'Feature × lens matrix' };

/** Mounted always (cheap: one store slice); the page state lives here, so the selection and filters outlive a close. */
export function LedgerPage({ lensButton, lensPanel, phone = false }: LedgerPageProps) {
  const s = useBp((s) => ({ page: s.page, lv: s.lv, phone: s.phone }), shallowEqual);
  const [ui, setUi] = useState<LedgerUi>(EMPTY_UI);
  const set = useCallback<SetUi>((f) => setUi(f), []);
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
    if (t.closest('.lg-side')) return; // the temporary-lens panel keeps its own keys
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
        {lensButton ? <div className="lg-slot">{lensButton}</div> : null}
      </header>
      <Filters L={L} filter={filter} />
      <div className="lg-main">
        <div className="lg-body" role={phone ? undefined : 'tabpanel'} aria-label={NAMES[lv]}>{view}</div>
        {lensPanel ? <aside className="lg-side" aria-label="Temporary lens">{lensPanel}</aside> : null}
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
function Filters({ L, filter }: { L: Ledger; filter: React.RefObject<HTMLInputElement | null> }) {
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
          <button key={l.id} type="button" className="lg-chip" aria-pressed={ui.lens.has(l.id)} title={l.name} onClick={() => set((u) => ({ ...u, lens: flip(u.lens, l.id) }))}>
            <LensGlyph g={l.glyph} />{l.short}<b>{l.n}</b>
          </button>
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
