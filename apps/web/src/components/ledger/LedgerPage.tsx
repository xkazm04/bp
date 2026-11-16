'use client';
// The findings ledger: a full page over the plan area, on the same route (the header's "drawing set | findings
// ledger" switch, or L), so the engine, the live stream and running scans stay alive behind it. One stage strip, the work in
// order: Backlog, In packs, Matrix, Release (train/release/ReleaseView.tsx), and the Lenses as a station of their own
// (lens/LensesPanel.tsx takes the sheet while open). The table and the matrix work in one of two scopes (LedgerUi.scope):
//   In packs   the built items of the lens packs (train/PackTable.tsx): sticky pack rows over their items, a click
//              opens an item in the compare panel docked beside the table (train/compare), and the decision bar
//              (train/DecisionBar.tsx) accepts, sends to rework, descopes or undoes (train/Decide.tsx, the one control);
//   Backlog    every finding of every lens: on a wide window the schedule sheet beside the wave dock and the brief (backlog/*, the
//              owner's pick of 2026-11-07); on the phone variants/Triage.tsx, the wave strip and the composer. A wave change shows at
//              once and saves itself (backlog/bench.ts); the brief peeks in the dock and maximizes into a modal (B, a click, or N).
// The matrix shows where findings (or, in packs, pack items by their state marks) sit and picks them by area; a
// matrix row's Table (or Enter) opens the table on that feature alone, a removable chip. In packs, the items already on
// the base branch get outcome chips beside the status chips (train/onMain.ts, from trackOf with git's landings): Held,
// Short, Not measured since, each a filter with its count; they show once something has landed. The selection and the filters
// are shared by the views; a scope switch drops the status filter (the scopes' chips differ). The drawing set's palette and type
// are the look (ledger-theme.css; the owner's ruling of 2026-11-07).
//
// Layout: the header stays (the switch, the project, the lens tabs); the page covers the rail, the timeline and the plan's floating controls,
// which act on the plan (fly, scrub, open a flyout) and have nothing to say about a list, and it gets the full
// width the triage table needs. The chrome it covers is inert while it shows (Tab never lands behind it); the toast
// stays reachable above it. Opaque paper, no backdrop-filter over the live canvas (docs/perf.md).
//
// Keys while the page has focus (it owns them: `data-keys="own"`, so the engine's plan keys stay out) come from one
// table, train/keymap.ts, by scope: In packs J/K move, X/Space select, Enter compares (again: full width), A R S U
// decide, E measures what the decision would act on (one selection scan per lens over its items' features: actions.ts
// measureItems; a scan, so BP_WRITES=off leaves it on), the compare panel's L M W while it is open; Backlog D dispatches the selection and A the focused finding,
// Y approves the focused finding for later and N declines it with a reason (BriefDrawer.tsx, the focused row's brief docked
// beside the table; no job queued; BP_WRITES=off binds neither), Enter opens its feature; Release B and F press the release view's Build and Finish (its `data-act` buttons). Every
// scope: / filters, 1-3 switch the tab, ? shows every key. Esc is layered: a note being written, then full width, then
// the compare panel, then the selection, then (Release) the table, else back to the drawing set.
// On a phone the page is the table alone (Phone.tsx hosts it with `phone`): pack items as cards over the decision
// bar, compare as a full-screen sheet that owns a history entry (Back closes it), the release as one status line.
//
// Lens actions: each lens chip has a disclosure (▾) with Scan this lens, Scan selection, Execute backlog (n) and Open in
// Lenses panel; with a selection the top bar offers "Scan selected features" (a picker of scannable lenses, one
// selection scan each). Both go through lens/lens-ops.ts, as the Lenses panel does.
//
// Waves: the dock (backlog/Schedule.tsx WaveDock) beside the Backlog's table and matrix; a wave's number filters the rows to it.
// On the phone `waves/WavesBar.tsx` tops the body and "Add to wave" opens the inline composer (waves/WaveComposer.tsx). Keys:
// 1-9 place in a draft, + starts one, 0 takes out, Z undoes; ] and [ walk the stages in every scope.
//
// v5 (scan-finding/1): the lens MVPs strip (variants/MvpStrip.tsx) tops the Backlog scope above the wave strip; the top bar
// carries Every lens (a live product: ONE measure or propose job over every enabled lens) and Trust (TrustPanel.tsx, the
// store's autonomy ledger, read only). The table's Score cell, predicted verdict, machine mark and reserve groups are
// variants/Triage.tsx's; the veto of a machine decision is the Review flyout's (rail/wide/review.tsx).
//
// Mount: through `LedgerPageLazy` (Phone.tsx: React.lazy, its own chunk), `<LedgerPageLazy lensButton={<LensesButton />} lensPanel={<LensesPanel />} />` in BlueprintApp's Chrome
// (it renders nothing unless the store's `page` is 'ledger'); the slots take the Lenses button and panel.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { LEDGER_VARIANTS, type LedgerVariant } from '@/engine/state';
import { useProductName } from '@/lib/scan/projects';
import { MAX_SELECTION } from '@bp/core/scan/jobs';
import type { ProposalStatus } from '@bp/core/scan/types';
import { shallowEqual, useBp, useEngine, useLive, useScanCtx, useWritesOn } from '../hooks';
import { setLedgerUi, useLedger, useLedgerSelection, useLedgerUi, type CompareMode, type CompareTheme, type Ledger, type LedgerUi, type LensCol, type SetUi } from './useLedger';
import { LensGlyph, Risk, Size } from './variants/bits';
import { EXEC_BATCH, executeAsk, executeBacklog, scanBlock, scanNow, scanSelection, useLensRows, useLensStats } from './lens/lens-ops';
import { setLensesPanelOpen, useLensesOpen } from './lens/LensesPanel';
import { EVERYTHING_SCOPE, openDirectedScan } from '../DirectedScan';
import { DispatchBar, Triage } from './variants/Triage';
import { WavesBar } from './waves/WavesBar';
import { MvpStrip } from './variants/MvpStrip';
import { TrustPanel } from './TrustPanel';
import { BriefDrawer } from './BriefDrawer';
import { measureItems, refusalText, startAllLenses } from '@/lib/scan/actions';
import { Matrix } from './variants/Matrix';
import { PackTable } from './train/PackTable';
import { DecisionBar } from './train/DecisionBar';
import { DecideOrder, useDecide } from './train/Decide';
import { KeyLine, KeysSheet } from './train/KeysSheet';
import { COMPARE_MODES, keyAction, type KeyScope } from './train/keymap';
import { ItemText } from './train/compare/ItemText';
import { Seg } from './train/ui/Controls';
import { StateMark } from './train/ui/Marks.tsx';
import { ComparePanel } from './train/compare/ComparePanel';
import { MAIN_CHIPS, useOnMain, type OnMain } from './train/onMain';
import { ReleaseStatusLine, ReleaseView, SummaryStrip } from './train/release/ReleaseView';
import { useWaveBench } from './backlog/bench';
import { Backlog, BenchStatus, Meter, Pin, PlaceBar, Slots, type CarryApi } from './backlog/parts';
import { Schedule, WaveDock } from './backlog/Schedule';
import './backlog/backlog.css';
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
/** The stage strip, in the order of the work; ] and [ walk it. */
type Stage = 'backlog' | 'packs' | 'matrix' | 'release';
const STAGES: readonly Stage[] = ['backlog', 'packs', 'matrix', 'release'];
const STAGE_TITLE: Record<Stage, string> = { backlog: 'Every finding of every lens: choose, group into waves, dispatch', packs: 'What the lens packs built: accept, rework, descope', matrix: 'Where the findings sit: feature by lens', release: 'Cut the release from what was accepted' };
const THEMES: readonly CompareTheme[] = ['light', 'dark', 'both'];
const MODES: readonly CompareMode[] = COMPARE_MODES.map((m) => m.value);
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
  const E = useEngine(), main = useOnMain(), L = useLedger(ui, set, main.outcome), live = useLive();
  const name = useProductName(E.M.live?.slug ?? null, E.M.P.name);
  const root = useRef<HTMLElement>(null), filter = useRef<HTMLInputElement>(null);
  const [keys, setKeys] = useState(false);
  // the finding whose decline reason is being written in the brief drawer (null: none)
  const [declining, setDeclining] = useState<string | null>(null);
  // the brief maximized over the page (the modal): it stays open as J/K walk the findings, so it reads as a review
  const [briefMax, setBriefMax] = useState(false);
  const modal = useRef<HTMLDivElement>(null);
  const B = useWaveBench(L), lensesOn = useLensesOpen() && !phone;
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
      if (el === page || el.contains(page!) || el.id === 'hdr' || el.id === 'toast' || el.id === 'directed' || el.classList.contains('toast-live')) return;
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
  // show, so a later close stays closed. The once is spent only when the pack table is actually what shows: the
  // ledger opens on Backlog, and spending it there left In packs with nothing open and J/K with nowhere to start
  const autoOpened = useRef(false), first = L.scoped[0]?.p.id;
  useEffect(() => {
    if (autoOpened.current || !first) return;
    if (phone || lv !== 'triage' || ui.scope !== 'packs' || window.innerWidth <= 1100) return;
    autoOpened.current = true;
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
  // the Backlog table's focused finding (the row Triage marks focused: the focus, else the first row) has its brief docked beside it
  const briefId = !phone && !packs && lv === 'triage' ? (ui.focus && L.byId.has(ui.focus) ? ui.focus : L.rows[0]?.p.id ?? null) : null;
  const decline = async (id: string, reason: string) => { if (await L.decideOne(id, 'decline', reason)) setDeclining(null); };
  // the wide Backlog draws its rows by lens and the matrix by domain: J/K walk them as drawn
  const drawn = (): readonly string[] => (!phone && (lv === 'matrix' || (!packs && lv === 'triage')) && root.current?.querySelectorAll ? Array.from(root.current.querySelectorAll<HTMLElement>('.sc-sheet [data-fid], .lg-mx [data-fid]')).map((e) => e.dataset.fid!) : []);
  const step = (d: number) => {
    const dom = drawn(), ord = dom.length ? dom : L.order(lv); if (!ord.length) return;
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

  // the modal's containment (modal-stack/focus-and-scroll-containment): focus enters on open and comes back on close, to the row
  // the walk ended on, else to the invoker, else to the page; everything behind it is inert while it shows
  const maxShown = briefMax && !!briefId;
  useEffect(() => {
    if (!maxShown) return;
    const invoker = document.activeElement as HTMLElement | null;
    if (!modal.current?.contains(document.activeElement)) modal.current?.focus({ preventScroll: true });
    return () => {
      const row = root.current?.querySelector?.<HTMLElement>('[data-fid="' + CSS.escape(uiFocus.current ?? '') + '"]');
      (row ?? (invoker?.isConnected ? invoker : root.current))?.focus({ preventScroll: true });
    };
  }, [maxShown]);
  const uiFocus = useRef(ui.focus); uiFocus.current = ui.focus;
  const trapTab = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return;
    const els = Array.from(modal.current?.querySelectorAll<HTMLElement>('button:not([disabled]), textarea, input, a[href], summary') ?? []);
    if (!els.length) { e.preventDefault(); return; }
    const first = els[0], last = els[els.length - 1], at = document.activeElement;
    if (e.shiftKey && (at === first || at === modal.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
  };
  const stage: Stage = lv === 'release' ? 'release' : lv === 'matrix' ? 'matrix' : ui.scope;
  const goStage = (to: Stage) => {
    setLensesPanelOpen(false);
    if (to === 'release' || to === 'matrix') { E.setPage('ledger', to === 'release' ? 'release' : 'matrix'); return; }
    L.setScope(to); E.setPage('ledger', 'triage');
  };
  /** What the wave keys act on: the selection, else the focused finding (or matrix row). */
  const placeIds = (): string[] => (ui.sel.size ? [...ui.sel] : under(ui.focus && (L.byId.has(ui.focus) || ui.focus.startsWith('feat:')) ? ui.focus : current()));

  const toRelease = () => { if (!phone) E.setPage('ledger', 'release'); };
  const ctx = useScanCtx();
  const measure = () => {
    const items = targets.map((id) => L.byId.get(id)?.p).filter((p) => !!p).map((p) => ({ lens: p.lens, feature: p.feature }));
    if (!items.length) { E.toast('Nothing to measure', 'Select items, or focus one, first'); return; }
    measureItems(ctx, items).then(({ jobs, refused }) => {
      const said = jobs.map((j) => { const k = j.scope?.features.length ?? 0; return j.lens + ' (' + k + (k === 1 ? ' feature' : ' features') + ')'; }).join(', ');
      const why = refused.map((r) => r.lens + ': ' + refusalText(r.error)).join('; ');
      if (!jobs.length) E.toast('Measure not started', why);
      else E.toast('Measuring ' + jobs.length + (jobs.length === 1 ? ' lens' : ' lenses'), 'one scan per lens: ' + said + (why ? ' · not started: ' + why : ''));
    }, (e) => E.toast('Measure not started', refusalText(e)));
  };
  const onKey = (e: React.KeyboardEvent<HTMLElement>) => {
    const t = e.target as HTMLElement, k = e.key;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && k.toLowerCase() === 'z' && !phone && scope === 'backlog' && L.writes && !isTyping(t)) { e.preventDefault(); B.undo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (keys) { if (k === 'Escape' || k === '?') { e.preventDefault(); setKeys(false); } return; }
    if (isTyping(t)) {
      if (k === 'Escape') { e.preventDefault(); if (ui.q) set((u) => ({ ...u, q: '' })); else root.current?.focus(); }
      return;
    }
    if (t.closest('.lg-side, .lg-pop, .lg-waves, .lg-trust')) return; // the Lenses panel, the lens menus, the wave strip and the trust panel keep their own keys
    const ctl = isControl(t), a = keyAction(cmpOpen ? ['compare', scope] : [scope], k, L.writes);
    if (!a || ((a === 'select' && k === ' ') || a === 'open') && ctl) return;
    if (phone && (a === 'view1' || a === 'view2' || a === 'view3' || a === 'stageNext' || a === 'stagePrev' || a === 'place' || a === 'newWave' || a === 'unplace' || a === 'undoPlace' || a === 'brief')) return;
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
      case 'measure': measure(); return;
      case 'dispatch': void L.dispatchIds(); return;
      case 'dispatchFocused': void L.dispatchIds(under(current())); return;
      case 'approveLater': { const id = current(); if (id && !id.startsWith('feat:')) void L.decideOne(id, 'approve'); return; }
      case 'decline': { const id = current(); if (id && !id.startsWith('feat:') && L.byId.get(id)?.status === 'proposed') { setDeclining(id); if (!phone) setBriefMax(true); } return; }
      case 'place': { const ids = placeIds(); if (ids.length) B.placeAt(ids, +k - 1); return; }
      case 'newWave': { const ids = placeIds(); if (ids.length) B.place(ids, { wave: 'new' }); return; }
      case 'unplace': { const ids = placeIds(); if (ids.length) B.place(ids, { wave: null }); return; }
      case 'undoPlace': B.undo(); return;
      case 'brief': if (briefId) setBriefMax((m) => !m); return;
      case 'stageNext': case 'stagePrev': { const i = STAGES.indexOf(stage), n = STAGES.length; goStage(STAGES[(i + (a === 'stageNext' ? 1 : n - 1)) % n]); return; }
      case 'filter': filter.current?.focus(); return;
      case 'view1': case 'view2': case 'view3': E.setPage('ledger', LEDGER_VARIANTS[+a.slice(4) - 1]); return;
      case 'theme': set((u) => ({ ...u, cmp: { ...u.cmp, theme: cycle(THEMES, u.cmp.theme) } })); return;
      case 'mode': set((u) => ({ ...u, cmp: { ...u.cmp, mode: cycle(MODES, u.cmp.mode) } })); return;
      case 'wide': set((u) => ({ ...u, wide: !u.wide })); return;
      // the release view owns B, F and T (its root's handler runs them with their confirmations); nothing to do here
      case 'build': case 'finish': case 'tag': return;
      case 'help': setKeys(true); return;
      case 'escape':
        if (declining) setDeclining(null);
        else if (maxShown) setBriefMax(false);
        else if (ui.note) set((u) => ({ ...u, note: null }));
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
      : packs ? <PackTable L={L} sample={!live} onLenses={() => setLensesPanelOpen(true)} /> : phone ? <Triage L={L} /> : <Schedule />;
  // the wave strip tops the Backlog scope (the table or the matrix, whose rows the selected wave filters); In packs and Release have none
  const waveStrip = phone && lv !== 'release' && !packs ? <WavesBar L={L} /> : null;
  // the lens MVPs (v5) top the Backlog scope's table and matrix, above the wave strip
  const mvpStrip = phone && lv !== 'release' && !packs ? <MvpStrip L={L} /> : null;
  // the compare panel (WP4b) docks beside the table while a pack item is open; the release tab and the backlog have none
  const cmp = cmpOpen && lv !== 'release' ? (
    <ComparePanel id={ui.open!} view={ui.cmp} wide={ui.wide} phone={phone}
      onView={(v) => set((u) => ({ ...u, cmp: v }))} onWide={() => set((u) => ({ ...u, wide: !u.wide }))} onClose={() => set((u) => ({ ...u, open: null, wide: false }))} />
  ) : null;
  const pkg = useMemo(() => L.items.filter((f) => f.status === 'accepted' && !f.p.release_id).length, [L.items]);
  const hint = <KeyLine scope={scope} />;
  const bar = lv === 'release' ? null
    : packs ? <DecisionBar L={L} targets={targets} onRelease={toRelease} hint={phone ? null : hint} phone={phone} />
      : <DispatchBar L={L} hint={phone ? null : hint} {...(phone ? {} : { place: <PlaceBar /> })} />;
  // the focused row's brief: one element, peeking in the dock or maximized in the modal
  const brief = briefId ? (
    <BriefDrawer id={briefId} full={maxShown} decide={L.writes ? {
      status: L.byId.get(briefId)?.status ?? 'proposed', declining: declining === briefId,
      approve: () => void L.decideOne(briefId, 'approve'), startDecline: () => { setDeclining(briefId); if (!phone) setBriefMax(true); },
      decline: (r) => void decline(briefId, r), cancel: () => { setDeclining(null); (modal.current ?? root.current)?.focus({ preventScroll: true }); },
    } : undefined} />
  ) : null;
  const dock = !phone && !packs && lv !== 'release';
  const off = maxShown ? { inert: true } : {};
  const inner = (
    <DecideOrder.Provider value={order}>
      <Backlog.Provider value={{ L, B }}>
      <header className="lg-top" {...off}>
        <div className="lg-h" title={name + ' · ' + L.all.length + ' findings · ' + L.items.length + ' items in ' + L.packs.length + ' packs'}>
          <h2>Findings ledger</h2>
          <span className="lg-prod">{name} · {live ? 'lens release train' : 'sample findings, simulated execution'} · {L.all.length} findings · {L.items.length} items in {L.packs.length} packs</span>
          {phone ? <ReleaseStatusLine /> : null}
        </div>
        {!phone && (
          <div className="lg-tabs" role="tablist" aria-label="Ledger stages" data-role="tr-tabs">
            {STAGES.map((k) => (
              <button key={k} type="button" role="tab" aria-selected={stage === k && !lensesOn} className={stage === k && !lensesOn ? 'on' : ''} onClick={() => goStage(k)} title={STAGE_TITLE[k] + ' ( [ and ] walk the stages )'}>
                {k === 'backlog' ? <>Backlog <b>{L.all.length}</b></> : k === 'packs' ? <>In packs <b>{L.items.length}</b></> : k === 'matrix' ? 'Matrix' : <>Release{pkg ? <b>{pkg}</b> : null}</>}
              </button>
            ))}
          </div>
        )}
        {!phone ? <SummaryStrip /> : null}
        <span className="lg-sp" />
        {!phone && dock && !lensesOn ? <BenchStatus /> : null}
        {!phone && ui.sel.size ? <SelScan L={L} /> : null}
        {!phone && live ? <AllLenses /> : null}
        {!phone ? <TrustPanel L={L} /> : null}
        {lensButton ? <div className="lg-slot">{lensButton}</div> : null}
      </header>
      {lv !== 'release' && !lensesOn ? <div className="lg-filtw" {...off}><Filters L={L} main={main} filter={filter} menus={!phone} scopeSeg={phone || lv === 'matrix'} quick={!phone && !packs} /></div> : null}
      <div className="lg-main" {...off}>
        {lensesOn ? null : <div className="lg-body" role={phone ? undefined : 'tabpanel'} aria-label={NAMES[lv]}>{mvpStrip}{waveStrip}{view}</div>}
        {lensesOn ? null : cmp}
        {!lensesOn && dock ? (
          <aside className="sc-dock" aria-label="Waves and brief">
            <WaveDock />
            {brief && !maxShown ? (
              <div className="sc-peek" title="Click to maximize the brief (B)" data-role="sc-peek"
                onClick={(e) => { if (!(e.target as HTMLElement).closest('button, a, textarea, input')) setBriefMax(true); }}>
                <button type="button" className="sc-max" aria-label="Maximize the brief" onClick={() => setBriefMax(true)}>⤢ <kbd>B</kbd></button>
                {brief}
              </div>
            ) : null}
          </aside>
        ) : null}
        {!lensesOn && phone && brief ? brief : null}
        {lensPanel ? <aside className="lg-side" aria-label="Lenses">{lensPanel}</aside> : null}
      </div>
      {lensesOn ? null : <div className="lg-barw" {...off}>{bar}</div>}
      {maxShown && brief ? (
        <div className="sc-scrim" onClick={(e) => { if (e.target === e.currentTarget) setBriefMax(false); }}>
          <div ref={modal} className="sc-modal" role="dialog" aria-modal="true" aria-label={'Brief · ' + (L.byId.get(briefId!)?.p.title ?? briefId)} tabIndex={-1} onKeyDown={trapTab} data-role="sc-modal">
            <BriefHead L={L} B={B} id={briefId!} onStep={step} onClose={() => setBriefMax(false)} />
            <div className="sc-modal-b">
              {brief}
              <BriefItem L={L} id={briefId!} />
            </div>
            <footer className="sc-modal-f"><span><kbd>J</kbd> <kbd>K</kbd> next finding</span><span><kbd>1</kbd>-<kbd>9</kbd> place</span><span><kbd>+</kbd> new wave</span>{L.writes ? <span><kbd>Y</kbd> approve · <kbd>N</kbd> decline</span> : null}<span><kbd>Esc</kbd> back to the sheet</span></footer>
          </div>
        </div>
      ) : null}
      {keys ? <KeysSheet scopes={cmpOpen ? [scope, 'compare'] : [scope]} onClose={() => setKeys(false)} writes={L.writes} /> : null}
      </Backlog.Provider>
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
function Filters({ L, main, filter, menus, scopeSeg, quick }: { L: Ledger; main: OnMain; filter: React.RefObject<HTMLInputElement | null>; menus: boolean; /** Show the In packs | Backlog switch (the phone, and the matrix, where the stage strip does not say the scope). */ scopeSeg: boolean; /** The wide Backlog's quick views in place of a row of status chips. */ quick: boolean }) {
  const { ui, set } = L, packs = ui.scope === 'packs';
  const flip = <T,>(xs: ReadonlySet<T>, x: T) => { const s = new Set(xs); if (!s.delete(x)) s.add(x); return s; };
  const any = ui.lens.size || ui.status.size || ui.main.size || ui.feat.size || ui.q;
  // the outcome chips count the pack items on the base branch (no filter applied), as the status chips count theirs
  const onMain = useMemo(() => {
    if (!packs) return [];
    const n = new Map<string, number>();
    for (const f of L.items) { const o = main.outcome.get(f.p.id); if (o) n.set(o, (n.get(o) ?? 0) + 1); }
    return n.size ? MAIN_CHIPS.filter((c) => (c.outcome !== 'no-target' && c.outcome !== 'out-of-bounds') || n.has(c.outcome)).map((c) => ({ ...c, n: n.get(c.outcome) ?? 0 })) : [];
  }, [packs, L.items, main.outcome]);
  // a lens chip counts the scope's rows: the pack items' lenses in packs, every lens with findings in the backlog
  const lenses = useMemo(() => {
    if (!packs) return L.lenses.filter((l) => l.n);
    const n = new Map<string, number>();
    for (const f of L.items) n.set(f.p.lens, (n.get(f.p.lens) ?? 0) + 1);
    return L.lenses.filter((l) => n.has(l.id)).map((l) => ({ ...l, n: n.get(l.id)! }));
  }, [packs, L.lenses, L.items]);
  return (
    <div className="lg-filt">
      {scopeSeg ? <Seg label="Scope" value={ui.scope} onChange={L.setScope} options={[
        { value: 'packs', label: 'Packs ' + L.items.length, title: 'The built items of the lens packs: accept, rework, descope' },
        { value: 'backlog', label: 'Backlog ' + L.all.length, title: 'Every finding of every lens: select and dispatch' },
      ]} /> : null}
      {quick ? <QuickViews L={L} /> : (
        <div className="lg-chips" role="group" aria-label="Status">
          {L.chips.map(({ status: st, n }) => (
            <button key={st} type="button" className={'lg-chip s-' + st} aria-pressed={ui.status.has(st)} onClick={() => set((u) => ({ ...u, status: flip(u.status, st) }))}>
              <StateMark status={st} form="glyph" />{st}<b>{n}</b>
            </button>
          ))}
        </div>
      )}
      {onMain.length ? (
        <div className="lg-chips" role="group" aria-label={'On ' + (main.base ?? 'the base branch')} data-role="tr-main-chips">
          {onMain.map((c) => (
            <button key={c.outcome} type="button" className={'lg-chip m-' + c.outcome} aria-pressed={ui.main.has(c.outcome)} title={c.label + ' on ' + (main.base ?? 'the base branch') + ': ' + c.hint}
              onClick={() => set((u) => ({ ...u, main: flip(u.main, c.outcome) }))}>
              {c.label}<b>{c.n}</b>
            </button>
          ))}
        </div>
      ) : null}
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
      {any ? <button type="button" className="lg-x" onClick={() => set((u) => ({ ...u, lens: new Set(), status: new Set(), main: new Set(), feat: new Set(), q: '' }))}>Clear filters</button> : null}
    </div>
  );
}

// ------------------------------------------------------------------------------------------- the Backlog's status views
const VIEWS: { k: string; label: string; set: readonly ProposalStatus[]; title: string }[] = [
  { k: 'decide', label: 'To decide', set: ['proposed'], title: 'Proposed findings' },
  { k: 'open', label: 'Open', set: ['proposed', 'approved'], title: 'Proposed and approved: what can still go' },
  { k: 'all', label: 'All', set: [], title: 'Every finding, built and declined too' },
];
/** The three views the work asks for, and every single status behind a disclosure. */
function QuickViews({ L }: { L: Ledger }) {
  const { ui, set } = L, pop = usePop();
  const on = VIEWS.find((v) => v.set.length === ui.status.size && v.set.every((s) => ui.status.has(s)))?.k ?? '';
  return (
    <div className="lg-qv" role="group" aria-label="Which findings">
      {VIEWS.map((v) => <button key={v.k} type="button" className="lg-chip" title={v.title} aria-pressed={on === v.k} onClick={() => set((u) => ({ ...u, status: new Set(v.set) }))}>{v.label}</button>)}
      <button ref={pop.btn} type="button" className="lg-chip" aria-haspopup="true" aria-expanded={pop.open} aria-pressed={!on} title="Filter by one status" onClick={() => pop.setOpen(!pop.open)}>Status <span aria-hidden="true">▾</span></button>
      {pop.open ? (
        <div ref={pop.box} className="lg-pop" role="group" aria-label="Status" data-keys="own" onKeyDown={pop.onKey} onBlur={pop.onBlur}>
          {L.chips.map(({ status: st, n }) => (
            <button key={st} type="button" className="lg-mi lg-mi-st" aria-pressed={ui.status.has(st)} onClick={() => set((u) => { const s = new Set(u.status); if (!s.delete(st)) s.add(st); return { ...u, status: s }; })}>
              <span><StateMark status={st} form="glyph" /> {st} <b>{n}</b>{ui.status.has(st) ? ' ✓' : ''}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------------------------------- the brief's modal
/** The modal's head: what is being read, how it scores, where it stands, and the walk. */
function BriefHead({ L, B, id, onStep, onClose }: { L: Ledger; B: ReturnType<typeof useWaveBench>; id: string; onStep(d: number): void; onClose(): void }) {
  const f = L.byId.get(id), at = B.spot.get(id), max = useMemo(() => L.all.reduce((m, x) => Math.max(m, x.w.value ?? 0), 0), [L.all]);
  const api = useMemo<CarryApi>(() => ({ selected: () => new Set<string>(), titleOf: () => id, setDrag: B.setDrag, place: B.place, readOnly: B.readOnly }), [id, B.setDrag, B.place, B.readOnly]);
  if (!f) return null;
  const mv = L.move(f.p);
  return (
    <header className="sc-modal-h">
      <Pin lens={f.p.lens} status={f.status} risk={f.p.risk} px={22} n={at?.draft ? at.n : undefined} />
      <h3>{f.p.title}</h3>
      <span className="sc-modal-a">
        <button type="button" aria-label="Previous finding" title="Previous finding (K)" onClick={() => onStep(-1)}>↑</button>
        <button type="button" aria-label="Next finding" title="Next finding (J)" onClick={() => onStep(1)}>↓</button>
        <button type="button" aria-label="Close the brief" title="Back to the sheet (Esc)" onClick={onClose}>×</button>
      </span>
      <div className="sc-modal-m">
        <button type="button" className="sc-flink" disabled={!f.fid} onClick={() => L.openFeature(f)}>{f.fname}</button>
        {mv ? <span>{mv}</span> : null}
        <Meter f={f} max={max} /><Risk p={f.p} /><Size p={f.p} />
        <Slots id={id} title={f.p.title} at={at?.draft ? at.wave.id : undefined} drafts={B.drafts.map((w) => w.id + '\t' + w.name).join('\n')} api={api} canPlace={f.can || !!at?.draft} />
      </div>
    </header>
  );
}

/** The finding's own words beside its brief: what would be built. */
function BriefItem({ L, id }: { L: Ledger; id: string }) {
  const p = L.byId.get(id)?.p;
  if (!p?.body) return null;
  return <section className="sc-modal-t" aria-label="The finding"><h4>The finding{p.standard ? ' · ' + p.standard : ''}</h4><ItemText body={p.body} /></section>;
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
      {item('Directed scan…', block, () => { close(); openDirectedScan({ lens: l.id, scope: EVERYTHING_SCOPE }); })}
      {writes ? item('Execute backlog (' + n + ')', exBlock, () => setAsk(true), n > EXEC_BATCH ? 'in jobs of ' + EXEC_BATCH : undefined) : null}
      {item('Open in Lenses panel', null, () => { close(); setLensesPanelOpen(true, l.id); })}
    </>
  );
}

/** "Every lens": ONE measure or propose job over every enabled lens (`/lens-scan measure|propose --lens all`; one of the
 *  MAX_RUNNING slots). A live product only (the sample scans a lens at a time); single-lens jobs stay on the lens chips. */
function AllLenses() {
  const pop = usePop();
  const E = useEngine(), ctx = useScanCtx();
  const go = (phase: 'measure' | 'propose') => {
    pop.close();
    startAllLenses(ctx, phase).then(
      (j) => E.toast(phase === 'measure' ? 'Scanning every lens' : 'Proposing for every lens', 'one job (' + j.id + '): readings fill the plan as they come'),
      (e) => E.toast(phase === 'measure' ? 'Could not start the every-lens scan' : 'Could not start the every-lens propose', refusalText(e)),
    );
  };
  return (
    <div className="lg-selscan">
      <button ref={pop.btn} type="button" className="bt" aria-haspopup="true" aria-expanded={pop.open} onClick={() => pop.setOpen(!pop.open)}
        title="Measure, or propose from the latest readings, through every enabled lens in one job">Every lens</button>
      {pop.open ? (
        <div ref={pop.box} className="lg-pop end" role="group" aria-label="Every lens" data-keys="own" onKeyDown={pop.onKey} onBlur={pop.onBlur}>
          <div className="lg-pop-h">One job over every enabled lens</div>
          <button type="button" className="lg-mi" data-all="measure" onClick={() => go('measure')}><span>Measure every lens</span><small>/lens-scan measure --lens all</small></button>
          <button type="button" className="lg-mi" data-all="propose" onClick={() => go('propose')}><span>Propose for every lens</span><small>/lens-scan propose --lens all</small></button>
        </div>
      ) : null}
    </div>
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
