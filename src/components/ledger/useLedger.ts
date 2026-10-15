'use client';
// The findings ledger's one model, shared by its views (the triage table and the feature x lens matrix; the Release tab
// reads train/data.ts). Findings are store-shaped proposals from either source, and nothing here branches on which:
//   live product: `useLive().product.scan.proposals`, jobs from `useLive().product.jobs`;
//   Kettle:       the generated fixture `E.M.findings` overlaid by id with the scan sim's `snapshot().proposals`
//                 (the sim's current state wins; a proposal the sim made itself is appended), jobs from `scanSim.jobs()`.
// The selection, the filters and the focused row live in a module store here (`useLedgerUi`): they survive a view
// switch and closing the ledger, and the Lenses panel and the plan's right-click read the selection (`useLedgerSelection`:
// the features behind the selected findings) to offer a selection scan. This hook derives the rest. Dispatch goes through `dispatch(useScanCtx(), ids)` (src/lib/scan/actions.ts),
// optimistic: the proposed ones read approved until the next store or sim update, and a refusal rolls back with a toast.
// Two scopes over the same findings: In packs (the built items of the lens packs, grouped by pack, newest pack first:
// `packs`, triaged through train/Decide.tsx) and Backlog (every finding, dispatched from here). The filters apply to both.
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { isView, lineSuffix } from '@/lib/model';
import { emptyScan, type Measurement, type Pack, type Proposal, type ProposalSize, type ProposalStatus, type ScanSnapshot, type TriageDecision } from '@/lib/scan/types';
import { isCurrent } from '@/lib/scan/derive';
import type { ScanJob } from '@/lib/scan/jobs';
import { dispatch } from '@/lib/scan/actions';
import type { ScanSim } from '@/lib/model/scan-sim';
import type { LedgerVariant } from '@/engine/state';
import type { GlyphSpec } from '@/engine/render/lens-glyph';
import { metricMove } from '../Queue';
import { useEngine, useLive, useScanCtx } from '../hooks';

/** Status order everywhere in the ledger: open first, then moving, then built and waiting, then a person's triage and
 *  the release (v2), then declined. */
export const STATUSES: readonly ProposalStatus[] = ['proposed', 'approved', 'executing', 'done', 'failed', 'accepted', 'rework', 'descoped', 'released', 'declined'];
/** The pack scope's status chips: built and waiting, then decided, then shipped. */
export const PACK_STATUSES: readonly ProposalStatus[] = ['done', 'failed', 'accepted', 'rework', 'descoped', 'released'];
/** The backlog's status chips: v1's six always; a v2 status only while some finding has it. */
const V1: ReadonlySet<ProposalStatus> = new Set(['proposed', 'approved', 'executing', 'done', 'failed', 'declined']);
const OPEN: ReadonlySet<ProposalStatus> = new Set(['proposed', 'approved']);
/** Effort per size (the rank's denominator and the dispatch bar's effort). */
export const SIZE_W: Record<ProposalSize, number> = { XS: 1, S: 2, M: 3, L: 5, XL: 8 };
export const sizeW = (p: Proposal): number => SIZE_W[p.size ?? 'M'] ?? SIZE_W.M;
/** Risk bands, the same cut as the live queue's urgency (7 and up high, 4 and up medium). A missing risk reads medium. */
export type RiskBand = 'high' | 'medium' | 'low';
export const riskBand = (r: number | undefined): RiskBand => (r === undefined ? 'medium' : r >= 7 ? 'high' : r >= 4 ? 'medium' : 'low');

export interface Finding {
  p: Proposal;
  /** The status shown: the row's, or the optimistic one while a dispatch is in flight. */
  status: ProposalStatus;
  /** The app's feature id to open (the product-line suffix at ?scale > 1); null when the plan lacks the feature. */
  fid: string | null;
  fname: string;
  /** The feature's domain name ('' when the map lacks the feature). */
  domain: string;
  /** Map order of the feature (rows of the matrix keep it). */
  fi: number;
  /** An execute job queued or running over it. */
  job: ScanJob | null;
  /** Expected value per effort (the triage order within a status): see `rankValue`. */
  ev: number;
  /** Whether it can be dispatched now: proposed or approved, and no job is on it. */
  can: boolean;
}

/** A column of the matrix and a filter chip: an enabled lens, or a lens id the findings name that the map does not enable. */
export interface LensCol { id: string; short: string; name: string; glyph: GlyphSpec; n: number; enabled: boolean }

const NO_P: readonly Proposal[] = [], NO_J: readonly ScanJob[] = [];
function useSimTick(sim: ScanSim | null): number {
  const [v, setV] = useState(0);
  useEffect(() => (sim ? sim.subscribe(() => setV((n) => n + 1)) : undefined), [sim]);
  return v;
}

/**
 * The raw findings and jobs, from the live store or the Kettle fixture + scan sim. Cheap enough for the header badge:
 * the live branch only picks fields, the Kettle branch merges once per sim change.
 */
export function useFindings(): { proposals: readonly Proposal[]; jobs: readonly ScanJob[]; scan: ScanSnapshot | undefined } {
  const M = useEngine().M, lp = useLive()?.product, sim = lp ? null : M.scanSim ?? null;
  const tick = useSimTick(sim);
  const proposals = lp?.scan?.proposals, jobs = lp?.jobs, scan = lp?.scan, isLive = !!lp;
  return useMemo(() => {
    if (isLive) return { proposals: proposals ?? NO_P, jobs: jobs ?? NO_J, scan };
    const snap = sim?.snapshot(), base = M.findings ?? NO_P;
    if (!snap?.proposals.length) return { proposals: base, jobs: sim?.jobs() ?? NO_J, scan: snap };
    const over = new Map(snap.proposals.map((p) => [p.id, p])), known = new Set<string>();
    const out = base.map((p) => { known.add(p.id); return over.get(p.id) ?? p; });
    for (const p of snap.proposals) if (!known.has(p.id)) out.push(p);
    return { proposals: out, jobs: sim?.jobs() ?? NO_J, scan: snap };
    // tick: the sim's version (its snapshot and jobs change in place behind the same object)
  }, [isLive, proposals, jobs, scan, sim, M.findings, tick]);
}

/** Open (proposed) findings: the badge on the header's "findings ledger" switch. */
export function useOpenCount(): number {
  const { proposals } = useFindings();
  return useMemo(() => proposals.reduce((n, p) => n + (p.status === 'proposed' ? 1 : 0), 0), [proposals]);
}

/**
 * Expected value per effort, the triage table's order within a status (the order `/lens-scan execute` builds a batch in):
 *   ev = gain x confidence / effort
 *   gain       = 0.25 + 0.75 x |expected_delta| / the largest |expected_delta| among the findings of the same lens and
 *                metric (normalised per metric, so a KB and a finding count compare); 0.5 when the finding names no
 *                metric or no delta (its size is unknown: the middle)
 *   confidence = (11 - risk) / 10, risk 1..10 (a missing risk reads 5)
 *   effort     = size weight XS 1, S 2, M 3, L 5, XL 8 (a missing size reads M)
 * Ties go to the older finding, then the id.
 */
export function rankValue(ps: readonly Proposal[]): Map<string, number> {
  const top = new Map<string, number>();
  for (const p of ps) if (p.metric && p.expected_delta !== undefined) { const k = p.lens + '\u0000' + p.metric; top.set(k, Math.max(top.get(k) ?? 0, Math.abs(p.expected_delta))); }
  const out = new Map<string, number>();
  for (const p of ps) {
    const t = p.metric && p.expected_delta !== undefined ? top.get(p.lens + '\u0000' + p.metric) ?? 0 : 0;
    const gain = t > 0 ? 0.25 + (0.75 * Math.abs(p.expected_delta!)) / t : 0.5;
    const risk = Math.min(10, Math.max(1, p.risk ?? 5));
    out.set(p.id, (gain * (11 - risk)) / 10 / sizeW(p));
  }
  return out;
}
const byRank = (a: Finding, b: Finding) => b.ev - a.ev || (a.p.created_at < b.p.created_at ? -1 : a.p.created_at > b.p.created_at ? 1 : 0) || (a.p.id < b.p.id ? -1 : 1);

/** The ledger's page-level state: survives a view switch and the ledger being closed and opened again. */
export interface LedgerUi {
  sel: ReadonlySet<string>;
  lens: ReadonlySet<string>;
  status: ReadonlySet<ProposalStatus>;
  /** Feature slugs: the matrix's "Table" drill-down (empty: every feature). */
  feat: ReadonlySet<string>;
  q: string;
  focus: string | null;
  /** The triage table's scope: the built items of the packs (triage), or every finding (the backlog, dispatch). */
  scope: LedgerScope;
  /** The pack item whose evidence the compare panel shows; null = the panel is closed. */
  open: string | null;
  /** How the compare panel shows screens: which theme(s), and side by side, a slider, a blink or the change map. */
  cmp: CompareView;
  /** The compare panel takes the page's width (the table hides behind it). */
  wide: boolean;
  /** Triage decisions on their way: item id -> its status when the decision was sent. An item is pending while its
   *  status is still that one (train/Decide.tsx prunes the rest). */
  pending: ReadonlyMap<string, ProposalStatus>;
  /** A decision waiting for its note (the note editor shows in the decision bar, or in the compare footer). */
  note: NoteAsk | null;
}
/** A decision that needs a note before it is sent (src/lib/train/rules.ts noteRequired). */
export interface NoteAsk { ids: readonly string[]; decision: Exclude<TriageDecision, 'reopen'>; at: 'bar' | 'compare' }
export type LedgerScope = 'packs' | 'backlog';
export type CompareTheme = 'light' | 'dark' | 'both';
export type CompareMode = 'side' | 'slider' | 'blink' | 'map';
export interface CompareView { theme: CompareTheme; mode: CompareMode }
export const EMPTY_UI: LedgerUi = {
  sel: new Set(), lens: new Set(), status: new Set(), feat: new Set(), q: '', focus: null,
  scope: 'packs', open: null, cmp: { theme: 'light', mode: 'side' }, wide: false, pending: new Map(), note: null,
};
export type SetUi = (f: (u: LedgerUi) => LedgerUi) => void;

// The page state, one per tab: a module store, so the ledger (desktop or phone), the Lenses panel and the plan's
// right-click menu read the same selection. `product` resets it when another product is shown.
let UI: { product: string; ui: LedgerUi } = { product: '', ui: EMPTY_UI };
const uiSubs = new Set<() => void>();
const subUi = (f: () => void) => { uiSubs.add(f); return () => { uiSubs.delete(f); }; };
const getUi = () => UI.ui;
/** Change the ledger's page state (a no-op when `f` returns the same object). */
export const setLedgerUi: SetUi = (f) => { const n = f(UI.ui); if (n === UI.ui) return; UI = { ...UI, ui: n }; for (const s of [...uiSubs]) s(); };
/** The ledger's page state for `product` (a live slug, or 'kettle'): another product starts from an empty one. */
export function useLedgerUi(product: string): LedgerUi {
  if (UI.product !== product) UI = { product, ui: EMPTY_UI }; // read during render, before any subscriber hears of it
  return useSyncExternalStore(subUi, getUi, getUi);
}

/** The ledger's selection as the plan's feature slugs (map order, each once) and the lenses of the selected findings
 *  (first seen first). Findings on a feature the map lacks add no feature. */
export function useLedgerSelection(): { n: number; features: string[]; lenses: string[] } {
  const P = useEngine().M.P, sel = useSyncExternalStore(subUi, getUi, getUi).sel, { proposals } = useFindings();
  return useMemo(() => {
    if (!sel.size) return { n: 0, features: [], lenses: [] };
    const at = new Map(P.base.features.map((f, i) => [f.slug, i])), fs = new Set<string>(), ls = new Set<string>();
    let n = 0;
    for (const p of proposals) if (sel.has(p.id)) { n++; ls.add(p.lens); if (at.has(p.feature)) fs.add(p.feature); }
    return { n, features: [...fs].sort((a, b) => at.get(a)! - at.get(b)!), lenses: [...ls] };
  }, [P, sel, proposals]);
}

/** A pack in the In packs scope. */
export interface PackView { pack: Pack; items: readonly Finding[]; shown: readonly Finding[] }

export interface Ledger {
  ui: LedgerUi;
  set: SetUi;
  /** Every finding, merged, with the optimistic overlay. */
  all: readonly Finding[];
  byId: ReadonlyMap<string, Finding>;
  /** After the lens, status, feature and text filters, in triage order (status, then rank). */
  rows: readonly Finding[];
  lenses: readonly LensCol[];
  counts: Readonly<Record<ProposalStatus, number>>;
  /** Selected findings that can be dispatched. */
  ready: readonly Finding[];
  /** Effort of the selection's dispatchable findings. */
  effort: number;
  busy: boolean;
  scan: ScanSnapshot | undefined;
  /** The packs, newest first, each with its items (created order) and the ones the filters keep. */
  packs: readonly PackView[];
  /** Every pack item. */
  items: readonly Finding[];
  /** The status chips of the scope shown, with their counts. */
  chips: readonly { status: ProposalStatus; n: number }[];
  /** The rows the scope shows: the backlog's findings, or the packs' kept items in pack order. */
  scoped: readonly Finding[];
  setScope(scope: LedgerScope): void;
  toggle(id: string): void;
  /** Select (on true), deselect (false) or, without `on`, toggle all of `ids` (all selected: deselect them). */
  select(ids: readonly string[], on?: boolean): void;
  selectWhere(pred: (f: Finding) => boolean, on?: boolean): void;
  clear(): void;
  setFocus(id: string | null): void;
  /** Dispatch `ids` (default: the selection) as one execute run. Only the dispatchable ones go. */
  dispatchIds(ids?: readonly string[]): Promise<void>;
  /** The matrix's drill-down: the triage table, showing only this feature's findings (the other filters stay). */
  showInTable(slug: string): void;
  /** Switch to the drawing set and open the finding's feature on its lens's tab. */
  openFeature(f: Finding): void;
  /** `metric: before → expected unit` (Queue's helper), the before from the scan, else the map's facet value. */
  move(p: Proposal): string | null;
  /** The keyboard order of the view shown in the current scope (J/K). Matrix rows are `feat:<slug>`. */
  order(lv: LedgerVariant): readonly string[];
}

export function lensMeta(P: ReturnType<typeof useEngine>['M']['P'], id: string): Omit<LensCol, 'n'> {
  const d = P.LENS[id];
  return d ? { id, short: d.short, name: d.name, glyph: d.glyph, enabled: d.i >= 0 } : { id, short: id.replace(/^.*\./, '').slice(0, 4).toUpperCase(), name: id, glyph: null, enabled: false };
}
const tidy = (s: string) => s.toLowerCase();

export function useLedger(ui: LedgerUi, set: SetUi): Ledger {
  const E = useEngine(), M = E.M, P = M.P, ctx = useScanCtx();
  const src = useFindings();
  // the optimistic overlay: cleared by the next store or sim update (the rows then say what really happened)
  const [over, setOver] = useState<ReadonlyMap<string, ProposalStatus>>(() => new Map());
  const [busy, setBusy] = useState(false);
  useEffect(() => { setOver((o) => (o.size ? new Map() : o)); }, [src.proposals]);

  // the plan's features by slug (line 0 at ?scale > 1), names and domains from the map
  const feats = useMemo(() => {
    const sf = lineSuffix(P.scale, 0), dn = new Map(P.base.domains.map((d) => [d.id, d.name]));
    const m = new Map<string, { fid: string | null; name: string; domain: string; i: number }>();
    P.base.features.forEach((f, i) => m.set(f.slug, { fid: P.F[f.slug + sf] ? f.slug + sf : P.F[f.slug] ? f.slug : null, name: f.name, domain: dn.get(f.domain) ?? f.domain, i }));
    return m;
  }, [P]);

  // the jobs on each proposal (queued or running execute jobs)
  const jobOf = useMemo(() => {
    const m = new Map<string, ScanJob>();
    for (const j of src.jobs) if (j.kind === 'execute' && (j.status === 'queued' || j.status === 'running')) for (const id of j.proposals ?? []) m.set(id, j);
    return m;
  }, [src.jobs]);

  const all = useMemo<Finding[]>(() => {
    const ev = rankValue(src.proposals);
    return src.proposals.map((p) => {
      const f = feats.get(p.feature), status = over.get(p.id) ?? p.status, job = jobOf.get(p.id) ?? null;
      return { p, status, fid: f?.fid ?? null, fname: f?.name ?? p.feature, domain: f?.domain ?? '', fi: f?.i ?? 1e6, job, ev: ev.get(p.id) ?? 0, can: OPEN.has(status) && !job };
    });
  }, [src.proposals, feats, over, jobOf]);
  const byId = useMemo(() => new Map(all.map((f) => [f.p.id, f])), [all]);

  const lenses = useMemo<LensCol[]>(() => {
    const n = new Map<string, number>();
    for (const f of all) n.set(f.p.lens, (n.get(f.p.lens) ?? 0) + 1);
    const cols = P.lenses.map((l) => ({ ...lensMeta(P, l.id), n: n.get(l.id) ?? 0 }));
    for (const [id, k] of n) if (!P.LENS[id] || P.LENS[id].i < 0) cols.push({ ...lensMeta(P, id), n: k });
    return cols;
  }, [all, P]);

  const counts = useMemo(() => {
    const c = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<ProposalStatus, number>;
    for (const f of all) c[f.status] = (c[f.status] ?? 0) + 1;
    return c;
  }, [all]);

  const q = tidy(ui.q.trim());
  const textOk = useCallback((f: Finding) => !q || tidy([f.p.title, f.fname, f.p.feature, f.p.lens, P.LENS[f.p.lens]?.name ?? '', f.p.standard, f.p.id, f.p.metric ?? '', f.p.pack_id ?? ''].join(' ')).includes(q), [q, P]);
  const keep = useCallback((f: Finding) => (!ui.lens.size || ui.lens.has(f.p.lens)) && (!ui.status.size || ui.status.has(f.status)) && (!ui.feat.size || ui.feat.has(f.p.feature)) && textOk(f),
    [ui.lens, ui.status, ui.feat, textOk]);
  const rank = useMemo(() => new Map(STATUSES.map((s, i) => [s, i])), []);
  const rows = useMemo(() => all.filter(keep)
    .sort((a, b) => (rank.get(a.status) ?? STATUSES.length) - (rank.get(b.status) ?? STATUSES.length) || byRank(a, b)), [all, keep, rank]);

  // the packs, newest first; a pack's items in created order (store.mjs `proposals --pack`), the kept ones beside them
  const packList = src.scan?.packs;
  const { items, packs } = useMemo(() => {
    const by = new Map<string, Finding[]>(), items: Finding[] = [];
    for (const f of all) if (f.p.pack_id) { let a = by.get(f.p.pack_id); if (!a) by.set(f.p.pack_id, (a = [])); a.push(f); items.push(f); }
    const order = [...(packList ?? [])].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id < b.id ? 1 : -1));
    const packs = order.map((pack) => {
      const its = (by.get(pack.id) ?? []).sort((a, b) => (a.p.created_at < b.p.created_at ? -1 : a.p.created_at > b.p.created_at ? 1 : a.p.id < b.p.id ? -1 : 1));
      return { pack, items: its, shown: its.filter(keep) };
    });
    return { items, packs };
  }, [all, packList, keep]);
  const scoped = useMemo(() => (ui.scope === 'packs' ? packs.flatMap((k) => k.shown) : rows), [ui.scope, packs, rows]);

  const ready = useMemo(() => all.filter((f) => f.can && ui.sel.has(f.p.id)), [all, ui.sel]);
  const effort = ready.reduce((s, f) => s + sizeW(f.p), 0);

  // the before value: the scan's latest reading, else the map's facet value (Kettle has no store, a live map may hold a newer facet than any reading)
  const moveScan = useMemo<ScanSnapshot | undefined>(() => {
    const ms = src.scan?.measurements ?? [];
    const have = new Set(ms.filter(isCurrent).map((m) => m.feature + '\u0000' + m.lens + '\u0000' + m.metric)), extra: Measurement[] = [];
    for (const p of src.proposals) {
      if (!p.metric) continue;
      const k = p.feature + '\u0000' + p.lens + '\u0000' + p.metric, fid = feats.get(p.feature)?.fid;
      if (have.has(k) || !fid) continue;
      const fl = P.F[fid]?.lens[p.lens], v = fl?.v[p.metric];
      if (typeof v !== 'number') continue;
      have.add(k);
      extra.push({ id: -1 - extra.length, run_id: 'map', feature: p.feature, lens: p.lens, metric: p.metric, value: v, measured_at: fl?.facet?.measured_at ?? P.asOf });
    }
    if (!extra.length) return src.scan;
    const base = src.scan ?? emptyScan();
    return { ...base, measurements: ms.concat(extra) };
  }, [src.scan, src.proposals, feats, P]);
  const move = useCallback((p: Proposal) => metricMove(p, (l, k) => P.LENS[l]?.F[k]?.unit, moveScan), [P, moveScan]);

  const toggle = useCallback((id: string) => set((u) => { const s = new Set(u.sel); if (!s.delete(id)) s.add(id); return { ...u, sel: s }; }), [set]);
  const select = useCallback((ids: readonly string[], on?: boolean) => set((u) => {
    const s = new Set(u.sel), v = on ?? !ids.every((id) => s.has(id));
    for (const id of ids) if (v) s.add(id); else s.delete(id);
    return { ...u, sel: s };
  }), [set]);
  const selectWhere = useCallback((pred: (f: Finding) => boolean, on?: boolean) => select(rows.filter(pred).map((f) => f.p.id), on), [rows, select]);
  const clear = useCallback(() => set((u) => (u.sel.size ? { ...u, sel: new Set() } : u)), [set]);
  const setFocus = useCallback((id: string | null) => set((u) => (u.focus === id ? u : { ...u, focus: id })), [set]);

  const dispatchIds = useCallback(async (ids?: readonly string[]) => {
    if (busy) return; // one dispatch at a time: the next one would race the optimistic overlay
    const go = (ids ?? [...ui.sel]).map((id) => byId.get(id)).filter((f): f is Finding => !!f && f.can).map((f) => f.p.id);
    if (!go.length) { E.toast('Nothing to dispatch', 'select proposed or approved findings that no job is building'); return; }
    const mine = go.filter((id) => byId.get(id)!.status === 'proposed');
    setOver((o) => { const n = new Map(o); for (const id of mine) n.set(id, 'approved'); return n; });
    setBusy(true);
    // /dispatch takes at most 50 ids (MAX_PROPOSALS): one execute job per 50, sent in order; the first refusal stops the
    // rest, and the toast says what went before it
    const CHUNK = 50, jobs: string[] = [], sent = new Set<string>(), skipped: { id: string; status: string }[] = [];
    let built = 0;
    const line = () => 'execute job' + (jobs.length === 1 ? ' ' : 's ') + jobs.join(', ')
      + (skipped.length ? ' · ' + skipped.length + ' skipped (' + skipped.map((s) => s.id + ' ' + s.status).join(', ') + ')' : '');
    try {
      for (let i = 0; i < go.length; i += CHUNK) {
        const part = go.slice(i, i + CHUNK);
        const r = await dispatch(ctx, part);
        jobs.push(r.job.id); skipped.push(...r.skipped); built += r.job.proposals?.length ?? part.length;
        for (const id of part) sent.add(id);
      }
      E.toast('Dispatched ' + built + (built === 1 ? ' finding' : ' findings'), line());
    } catch (err) {
      // the overlay keeps what was sent; the unsent ids go back to what the store says
      setOver((o) => { const n = new Map(o); for (const id of mine) if (!sent.has(id)) n.delete(id); return n; });
      const why = err instanceof Error ? err.message : String(err);
      if (jobs.length) E.toast('Dispatch stopped after ' + built + ' of ' + go.length, line() + ' · then: ' + why);
      else E.toast('Dispatch failed', why);
    } finally {
      if (sent.size) set((u) => { const s = new Set(u.sel); for (const id of sent) s.delete(id); return { ...u, sel: s }; });
      setBusy(false);
    }
  }, [busy, ui.sel, byId, ctx, E, set]);

  const showInTable = useCallback((slug: string) => {
    set((u) => ({ ...u, feat: new Set([slug]), focus: null }));
    E.setPage('ledger', 'triage');
  }, [E, set]);

  const openFeature = useCallback((f: Finding) => {
    if (!f.fid) { E.toast('Not on the plan', f.p.feature + ' is not a feature of this map'); return; }
    E.setPage('plan');
    E.setView(isView(P, f.p.lens) ? f.p.lens : 'general');
    E.openFeature(f.fid);
  }, [E, P]);

  const order = useCallback((lv: LedgerVariant): readonly string[] => (lv === 'matrix' ? matrixRows(scoped).map((r) => 'feat:' + r.slug) : scoped.map((f) => f.p.id)), [scoped]);

  const chips = useMemo(() => {
    if (ui.scope === 'backlog') return STATUSES.filter((s) => V1.has(s) || counts[s]).map((status) => ({ status, n: counts[status] }));
    const c = new Map<ProposalStatus, number>();
    for (const f of items) c.set(f.status, (c.get(f.status) ?? 0) + 1);
    return PACK_STATUSES.map((status) => ({ status, n: c.get(status) ?? 0 }));
  }, [ui.scope, counts, items]);
  // the scopes' status chips differ, so a status filter does not cross a scope switch; focus and compare start over
  const setScope = useCallback((scope: LedgerScope) => set((u) => (u.scope === scope ? u : { ...u, scope, status: new Set(), focus: null, open: null, wide: false, note: null })), [set]);

  return { ui, set, all, byId, rows, lenses, counts, ready, effort, busy, scan: moveScan, packs, items, chips, scoped, setScope, toggle, select, selectWhere, clear, setFocus, dispatchIds, showInTable, openFeature, move, order };
}

// ------------------------------------------------------------------------------------------- the matrix's rows
/** The matrix's rows: one per feature with findings, in map order. */
export function matrixRows(rows: readonly Finding[]): { slug: string; name: string; domain: string; items: Finding[] }[] {
  const m = new Map<string, { slug: string; name: string; domain: string; fi: number; items: Finding[] }>();
  for (const f of rows) { let r = m.get(f.p.feature); if (!r) m.set(f.p.feature, (r = { slug: f.p.feature, name: f.fname, domain: f.domain, fi: f.fi, items: [] })); r.items.push(f); }
  return [...m.values()].sort((a, b) => a.fi - b.fi || (a.slug < b.slug ? -1 : 1));
}
