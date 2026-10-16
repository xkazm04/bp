'use client';
// The findings ledger: a full page over the plan area, on the same route (the header's "drawing set | findings
// ledger" switch, or L), so the engine, the live stream and running scans stay alive behind it. Three tabs (1-3): the
// Triage table, the Feature × lens matrix and the Release (train/release/ReleaseView.tsx). The table and the matrix
// work in one of two scopes, "In packs N | Backlog N" (LedgerUi.scope):
//   In packs   the built items of the lens packs (train/PackTable.tsx): sticky pack rows over their items, a click
//              opens an item in the compare panel docked beside the table (train/compare), and the decision bar
//              (train/DecisionBar.tsx) accepts, sends to rework, descopes or undoes (train/Decide.tsx, the one control);
//   Backlog    every finding of every lens (variants/Triage.tsx), selected and dispatched as before.
// The matrix shows where findings (or, in packs, pack items by their state marks) sit and picks them by area; a
// matrix row's Table (or Enter) opens the table on that feature alone, a removable chip. The selection and the filters
// are shared by the views; a scope switch drops the status filter (the scopes' chips differ). The contest winner A/1
// (release-manager) is the look: its type, density and palette (ledger-theme.css).
//
// Layout: the header stays (the switch, the project, the lens tabs); the page covers the rail and the timeline,
// which act on the plan (fly, scrub, open a flyout) and have nothing to say about a list, and it gets the full
// width the triage table needs. The chrome it covers is inert while it shows (Tab never lands behind it); the toast
// stays reachable above it. Opaque paper, no backdrop-filter over the live canvas (docs/perf.md).
//
// Keys while the page has focus (it owns them: `data-keys="own"`, so the engine's plan keys stay out) come from one
// table, train/keymap.ts, by scope: In packs J/K move, X/Space select, Enter compares (again: full width), A R S U
// decide, the compare panel's L M W while it is open; Backlog D dispatches the selection and A the focused finding,
// Enter opens its feature; Release B and F press the release view's Build and Finish (its `data-act` buttons). Every
// scope: / filters, 1-3 switch the tab, ? shows every key. Esc is layered: a note being written, then full width, then
// the compare panel, then the selection, then (Release) the table, else back to the drawing set.
// On a phone the page is the table alone (Phone.tsx hosts it with `phone`): pack items as cards over the decision
// bar, compare as a full-screen sheet that owns a history entry (Back closes it), the release as one status line.
//
// Lens actions: each lens chip has a disclosure (▾) with Scan this lens, Scan selection, Execute backlog (n) and Open in
// Lenses panel; with a selection the top bar offers "Scan selected features" (a picker of scannable lenses, one
// selection scan each). Both go through lens/lens-ops.ts, as the Lenses panel does.
//
// Mount: through `LedgerPageLazy` (Phone.tsx: React.lazy, its own chunk), `<LedgerPageLazy lensButton={<LensesButton />} lensPanel={<LensesPanel />} />` in BlueprintApp's Chrome
// (it renders nothing unless the store's `page` is 'ledger'); the slots take the Lenses button and panel.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { LEDGER_VARIANTS, type LedgerVariant } from '@/engine/state';
import { useProductName } from '@/lib/scan/projects';
import { MAX_SELECTION } from '@/lib/scan/jobs';
import { shallowEqual, useBp, useEngine, useLive, useScanCtx, useWritesOn } from '../hooks';
import { setLedgerUi, useLedger, useLedgerSelection, useLedgerUi, type CompareMode, type CompareTheme, type Ledger, type LedgerUi, type LensCol, type SetUi } from './useLedger';
import { LensGlyph } from './variants/bits';
import { EXEC_BATCH, executeAsk, executeBacklog, scanBlock, scanNow, scanSelection, useLensRows, useLensStats } from './lens/lens-ops';
import { setLensesPanelOpen } from './lens/LensesPanel';
import { DispatchBar, Triage } from './variants/Triage';
import { Matrix } from './variants/Matrix';
import { PackTable } from './train/PackTable';
import { DecisionBar } from './train/DecisionBar';
import { DecideOrder, useDecide } from './train/Decide';
import { KeyLine, KeysSheet } from './train/KeysSheet';
import { keyAction, type KeyScope } from './train/keymap';
import { Seg } from './train/ui/Controls';
import { StateMark } from './train/ui/Marks.tsx';
import { ComparePanel } from './train/compare/ComparePanel';
import { ReleaseStatusLine, ReleaseView, SummaryStrip } from './train/release/ReleaseView';
import './ledger.css';
import './ledger-theme.css';

export interface LedgerPageProps {
  /** The "Lenses" button (LensesButton), shown in the top bar. */
  lensButton?: ReactNode;
  /** The Lenses panel (LensesPanel), shown beside the ledger's body; it renders nothing while closed. */
  lensPanel?: ReactNode;
  /** The phone view hosts the ledger: the table only, in the page flow. */
  phone?: boolean;
}

const NAMES: Record<LedgerVariant, string> = { triage: 'Triage table', matrix: 'Feature × lens matrix', release: 'Release' };
const THEMES: readonly CompareTheme[] = ['light', 'dark', 'both'];
const MODES: readonly CompareMode[] = ['side', 'slider', 'blink', 'map'];
const cycle = <T,>(xs: readonly T[], x: T): T => xs[(xs.indexOf(x) + 1) % xs.length];

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
  const [keys, setKeys] = useState(false);
  const scope: KeyScope = lv === 'release' ? 'release' : ui.scope, packs = scope === 'packs';
  const cmpOpen = packs && !!ui.open;
  // the order "next waiting" walks after a decision: the table's kept rows
  const scopedIds = useMemo(() => L.scoped.map((f) => f.p.id), [L.scoped]);
  const order = useCallback(() => scopedIds, [scopedIds]);
  const { decide } = useDecide(order);

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

  // the focused row takes the keyboard focus when it changes (J/K, a decision's advance) while the page, a row or
  // nothing holds it; a control, the note editor or the compare panel keep theirs
  useEffect(() => {
    const page = root.current, at = document.activeElement as HTMLElement | null, id = ui.focus;
    if (!page || !id || (at && at !== document.body && at !== page && !at.hasAttribute('data-fid'))) return;
    const el = page.querySelector<HTMLElement>('[data-fid="' + CSS.escape(id) + '"]');
    if (el && el !== at) { el.focus({ preventScroll: true }); el.scrollIntoView({ block: 'nearest' }); }
  }, [ui.focus]);

  // a wide window opens the first pack item in the compare panel the first time the table shows it (A/1); once per
  // show, so a later close stays closed
  const autoOpened = useRef(false), first = L.scoped[0]?.p.id;
  useEffect(() => {
    if (autoOpened.current || !first) return;
    autoOpened.current = true;
    if (phone || lv !== 'triage' || ui.scope !== 'packs' || window.innerWidth <= 1100) return;
    set((u) => (u.open || u.focus ? u : { ...u, focus: first, open: first }));
  }, [first, phone, lv, ui.scope, set]);

  // the phone's compare sheet owns a history entry, so the platform Back gesture closes it (as Phone.tsx's detail)
  const sheet = phone && cmpOpen;
  useEffect(() => {
    if (!sheet) return;
    history.pushState({ ...(history.state ?? {}), lgCompare: true }, '');
    const onPop = () => set((u) => ({ ...u, open: null, wide: false }));
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (history.state?.lgCompare) history.back();   // closed some other way: consume the stranded entry
    };
  }, [sheet, set]);

  const current = (): string | null => { const ord = L.order(lv); return ui.focus && ord.includes(ui.focus) ? ui.focus : ord[0] ?? null; };
  const step = (d: number) => {
    const ord = L.order(lv); if (!ord.length) return;
    const i = ui.focus ? ord.indexOf(ui.focus) : -1, j = i < 0 ? (d > 0 ? 0 : ord.length - 1) : Math.max(0, Math.min(ord.length - 1, i + d)), id = ord[j];
    // the open compare follows the focus (A/1)
    set((u) => (u.focus === id && (!u.open || u.open === id) ? u : { ...u, focus: id, open: u.open && packs && lv === 'triage' ? id : u.open }));
  };
  /** The findings a focus id stands for: one, or a matrix row's. */
  const under = (id: string | null): string[] => !id ? [] : id.startsWith('feat:') ? L.scoped.filter((f) => 'feat:' + f.p.feature === id).map((f) => f.p.id) : [id];

  // what a decision acts on: the selected pack items, else the open item, else the focused one
  const itemIds = useMemo(() => new Set(L.items.map((f) => f.p.id)), [L.items]);
  const targets = useMemo(() => {
    const sel = [...ui.sel].filter((id) => itemIds.has(id));
    if (sel.length) return sel;
    if (ui.open && itemIds.has(ui.open)) return [ui.open];
    const f = ui.focus && itemIds.has(ui.focus) ? ui.focus : null;
    return f ? [f] : [];
  }, [ui.sel, ui.open, ui.focus, itemIds]);

  const toRelease = () => { if (!phone) E.setPage('ledger', 'release'); };
  const onKey = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement, k = e.key;
    if (keys) { if (k === 'Escape' || k === '?') { e.preventDefault(); setKeys(false); } return; }
    if (isTyping(t)) {
      if (k === 'Escape') { e.preventDefault(); if (ui.q) set((u) => ({ ...u, q: '' })); else root.current?.focus(); }
      return;
    }
    if (t.closest('.lg-side, .lg-pop')) return; // the Lenses panel and the lens menus keep their own keys
    const ctl = isControl(t), a = keyAction(cmpOpen ? ['compare', scope] : [scope], k);
    if (!a || ((a === 'select' && k === ' ') || a === 'open') && ctl) return;
    if (phone && (a === 'view1' || a === 'view2' || a === 'view3')) return;
    e.preventDefault();
    switch (a) {
      case 'next': step(1); return;
      case 'prev': step(-1); return;
      case 'select': { const ids = under(current()); if (ids.length) L.select(ids); return; }
      case 'open': {
        const id = current();
        if (id?.startsWith('feat:')) { L.showInTable(id.slice(5)); return; }
        if (!id) return;
        if (packs) { set((u) => (u.open === id ? { ...u, wide: !u.wide } : { ...u, focus: id, open: id })); return; }
        const f = L.byId.get(id); if (f) L.openFeature(f);
        return;
      }
      case 'accept': void decide(targets, 'accept'); return;
      case 'rework': void decide(targets, 'rework'); return;
      case 'descope': void decide(targets, 'descope'); return;
      case 'undo': void decide(targets, 'reopen'); return;
      case 'dispatch': void L.dispatchIds(); return;
      case 'dispatchFocused': void L.dispatchIds(under(current())); return;
      case 'filter': filter.current?.focus(); return;
      case 'view1': case 'view2': case 'view3': E.setPage('ledger', LEDGER_VARIANTS[+a.slice(4) - 1]); return;
      case 'theme': set((u) => ({ ...u, cmp: { ...u.cmp, theme: cycle(THEMES, u.cmp.theme) } })); return;
      case 'mode': set((u) => ({ ...u, cmp: { ...u.cmp, mode: cycle(MODES, u.cmp.mode) } })); return;
      case 'wide': set((u) => ({ ...u, wide: !u.wide })); return;
      // the release view owns B and F (its root's handler runs them with their confirmations); nothing to do here
      case 'build': case 'finish': return;
      case 'help': setKeys(true); return;
      case 'escape':
        if (ui.note) set((u) => ({ ...u, note: null }));
        else if (cmpOpen && ui.wide) set((u) => ({ ...u, wide: false }));
        else if (cmpOpen) set((u) => ({ ...u, open: null, wide: false }));
        else if (ui.sel.size) L.clear();
        else if (lv === 'release') E.setPage('ledger', 'triage');
        else E.setPage('plan');
        return;
    }
  };

  const view = lv === 'release' ? <ReleaseView phone={phone} />
    : lv === 'matrix' ? <Matrix L={L} />
      : packs ? <PackTable L={L} sample={!live} onLenses={() => setLensesPanelOpen(true)} /> : <Triage L={L} />;
  // the compare panel (WP4b) docks beside the table while a pack item is open; the release tab and the backlog have none
  const cmp = cmpOpen && lv !== 'release' ? (
    <ComparePanel id={ui.open!} view={ui.cmp} wide={ui.wide} phone={phone}
      onView={(v) => set((u) => ({ ...u, cmp: v }))} onWide={() => set((u) => ({ ...u, wide: !u.wide }))} onClose={() => set((u) => ({ ...u, open: null, wide: false }))} />
  ) : null;
  const pkg = useMemo(() => L.items.filter((f) => f.status === 'accepted' && !f.p.release_id).length, [L.items]);
  const hint = <KeyLine scope={scope} />;
  const bar = lv === 'release' ? null
    : packs ? <DecisionBar L={L} targets={targets} onRelease={toRelease} hint={phone ? null : hint} phone={phone} />
      : <DispatchBar L={L} hint={phone ? null : hint} />;
  const inner = (
    <DecideOrder.Provider value={order}>
      <header className="lg-top">
        <div className="lg-h">
          <h2>Findings ledger</h2>
          <span className="lg-prod">{name} · {live ? 'lens release train' : 'sample findings, simulated execution'} · {L.all.length} findings · {L.items.length} items in {L.packs.length} packs</span>
          {phone ? <ReleaseStatusLine /> : null}
        </div>
        {!phone ? <SummaryStrip /> : null}
        {!phone && (
          <div className="lg-tabs" role="tablist" aria-label="Ledger views" data-role="tr-tabs">
            {LEDGER_VARIANTS.map((k, i) => (
              <button key={k} type="button" role="tab" aria-selected={lv === k} className={lv === k ? 'on' : ''} onClick={() => E.setPage('ledger', k)} title={NAMES[k] + ' (' + (i + 1) + ')'}>
                {NAMES[k]}{k === 'release' && pkg ? ' · ' + pkg : ''}<kbd>{i + 1}</kbd>
              </button>
            ))}
          </div>
        )}
        {!phone && ui.sel.size ? <SelScan L={L} /> : null}
        {lensButton ? <div className="lg-slot">{lensButton}</div> : null}
      </header>
      {lv !== 'release' ? <Filters L={L} filter={filter} menus={!phone} /> : null}
      <div className="lg-main">
        <div className="lg-body" role={phone ? undefined : 'tabpanel'} aria-label={NAMES[lv]}>{view}</div>
        {cmp}
        {lensPanel ? <aside className="lg-side" aria-label="Lenses">{lensPanel}</aside> : null}
      </div>
      {bar}
      {keys ? <KeysSheet scopes={cmpOpen ? [scope, 'compare'] : [scope]} onClose={() => setKeys(false)} /> : null}
    </DecideOrder.Provider>
  );
  const cls = 'lg-page' + (cmp && ui.wide ? ' wide' : '');
  if (phone) return <section ref={root} className={cls + ' phone'} aria-label="Findings ledger" tabIndex={-1} onKeyDown={onKey}>{inner}</section>;
  return (
    <motion.section ref={root} className={cls} aria-label="Findings ledger" tabIndex={-1} data-keys="own" onKeyDown={onKey}
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24, ease: [0.2, 0.7, 0.2, 1] }}>
      {inner}
    </motion.section>
  );
}

/** The scope (In packs | Backlog), the status chips of the scope (each with its state mark and count), lens chips
 *  (glyph, short, count in the scope), the matrix's feature drill-down and the text filter. */
function Filters({ L, filter, menus }: { L: Ledger; filter: React.RefObject<HTMLInputElement | null>; menus: boolean }) {
  const { ui, set } = L, packs = ui.scope === 'packs';
  const flip = <T,>(xs: ReadonlySet<T>, x: T) => { const s = new Set(xs); if (!s.delete(x)) s.add(x); return s; };
  const any = ui.lens.size || ui.status.size || ui.feat.size || ui.q;
  // a lens chip counts the scope's rows: the pack items' lenses in packs, every lens with findings in the backlog
  const lenses = useMemo(() => {
    if (!packs) return L.lenses.filter((l) => l.n);
    const n = new Map<string, number>();
    for (const f of L.items) n.set(f.p.lens, (n.get(f.p.lens) ?? 0) + 1);
    return L.lenses.filter((l) => n.has(l.id)).map((l) => ({ ...l, n: n.get(l.id)! }));
  }, [packs, L.lenses, L.items]);
  return (
    <div className="lg-filt">
      <Seg label="Scope" value={ui.scope} onChange={L.setScope} options={[
        { value: 'packs', label: 'In packs ' + L.items.length, title: 'The built items of the lens packs: accept, rework, descope' },
        { value: 'backlog', label: 'Backlog ' + L.all.length, title: 'Every finding of every lens: select and dispatch' },
      ]} />
      <div className="lg-chips" role="group" aria-label="Status">
        {L.chips.map(({ status: st, n }) => (
          <button key={st} type="button" className={'lg-chip s-' + st} aria-pressed={ui.status.has(st)} onClick={() => set((u) => ({ ...u, status: flip(u.status, st) }))}>
            <StateMark status={st} form="glyph" />{st}<b>{n}</b>
          </button>
        ))}
      </div>
      <div className="lg-chips" role="group" aria-label="Lens">
        {lenses.map((l) => (
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
      <input ref={filter} className="lg-q" type="search" value={ui.q} placeholder={packs ? 'Filter items…  /' : 'Filter findings…  /'} aria-label={packs ? 'Filter pack items by text' : 'Filter findings by text'} onChange={(e) => { const q = e.target.value; set((u) => ({ ...u, q })); }} />
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
  const E = useEngine(), ctx = useScanCtx(), { rows } = useLensRows(), stat = useLensStats().get(l.id), sel = useLedgerSelection(), writes = useWritesOn();
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
      {writes ? item('Execute backlog (' + n + ')', exBlock, () => setAsk(true), n > EXEC_BATCH ? 'in jobs of ' + EXEC_BATCH : undefined) : null}
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
