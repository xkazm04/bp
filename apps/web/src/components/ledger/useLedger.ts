'use client';
// The findings ledger's one model, shared by its views (the triage table and the feature x lens matrix; the Release tab
// reads train/data.ts). Findings are store-shaped proposals from either source, and nothing here branches on which:
//   live product: `useLive().product.scan.proposals`, jobs from `useLive().product.jobs`;
//   Kettle:       the generated fixture `E.M.findings` overlaid by id with the scan sim's `snapshot().proposals`
//                 (the sim's current state wins; a proposal the sim made itself is appended), jobs from `scanSim.jobs()`.
// The selection, the filters and the focused row live in a module store here (`useLedgerUi`): they survive a view
// switch and closing the ledger, and the Lenses panel and the plan's right-click read the selection (`useLedgerSelection`:
// the features behind the selected findings) to offer a selection scan. This hook derives the rest. Dispatch goes through `dispatch(useScanCtx(), ids)` (src/lib/scan/actions.ts),
// optimistic through the ledger's intent store (intents.ts, `LedgerUi.intents`): a sent finding reads approved and is not
// dispatchable again until the store or sim shows it in another status (or the bound releases it with a toast); a refusal
// withdraws only that send's entries still at their sent-from status, with a toast. Closing the ledger keeps them.
// Two scopes over the same findings: In packs (the built items of the lens packs, grouped by pack, oldest pack first:
// `packs`, triaged through train/Decide.tsx) and Backlog (every finding, dispatched from here). The filters apply to both.
// Waves (useWaves.ts, waves/*): `waves` is the product's wave model; `LedgerUi.wave` is the selected wave tab (the backlog's
// `rows` keep only its findings) and `LedgerUi.composer` the open wave composer. `waveTag(id)` hands a row its wave chip as
// primitives (a stable callback: the memoised rows never see an object), `waveReady` / `waveTaken` split the dispatchable
// selection into what a new wave can take and what another draft wave already holds, and `dispatchWave` goes through the same
// send helper (`sendIntent`) as `dispatchIds`.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { isView, lineSuffix } from '@bp/core/model';
import { emptyScan, type Measurement, type Pack, type Proposal, type ProposalSize, type ProposalStatus, type ScanSnapshot, type TriageDecision, type TriageResult } from '@bp/core/scan/types';
import { isCurrent, tierRank } from '@bp/core/scan/derive';
import type { ScanJob } from '@bp/core/scan/jobs';
import { buildChunks, canBuild, holdsBuild } from '@bp/core/scan/admit';
import { dispatch } from '@/lib/scan/actions';
import type { ScanSim } from '@bp/core/model/scan-sim';
import type { LedgerVariant } from '@/engine/state';
import type { COMPARE_MODES } from './train/keymap';
import type { GlyphSpec } from '@/engine/render/lens-glyph';
import { metricMove } from '../Queue';
import { useEngine, useLive, useScanCtx, useWritesOn } from '../hooks';
import { useWaves, type WavesModel } from './useWaves';
import type { Wave, WaveDispatchResult } from '@bp/core/scan/waves';
import { byPackAge } from '@bp/core/train/rules';
import { GENERAL } from '@bp/core/data/types';
import { INTENT_BOUND_MS, expire, inFlight, nextAttempt, overlay, paint, revert, settle, type Intents, type StatusOf } from './intents';
// the one settle rule, for train/Decide.tsx's pending set (the train components import the ledger through this module)
export { settle } from './intents';

/** Status order everywhere in the ledger: open first, then moving, then built and waiting, then a person's triage and
 *  the release (v2), then declined. */
export const STATUSES: readonly ProposalStatus[] = ['proposed', 'approved', 'executing', 'done', 'failed', 'accepted', 'rework', 'descoped', 'released', 'declined'];
/** The pack scope's status chips: built and waiting, then decided, then shipped. */
export const PACK_STATUSES: readonly ProposalStatus[] = ['done', 'failed', 'accepted', 'rework', 'descoped', 'released'];
/** The backlog's status chips: v1's six always; a v2 status only while some finding has it. */
const V1: ReadonlySet<ProposalStatus> = new Set(['proposed', 'approved', 'executing', 'done', 'failed', 'declined']);
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
  /** Whether it can be dispatched now: proposed or approved, no job is on it, and no dispatch of it is in flight. */
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
  /** Dispatches on their way (intents.ts): finding id -> the status it was sent from, what it shows meanwhile, the send
   *  that painted it. Settled by the store's status (useLedger), never by an unrelated change. */
  intents: Intents;
  /** A decision waiting for its note (the note editor shows in the decision bar, or in the compare footer). */
  note: NoteAsk | null;
  /** The last triage decision that moved items (the store's `triaged`, so only what moved): what Undo and U reverse
   *  after the focus advanced (train/plan.ts undoTargets). One step deep, as the store's reopen; null = nothing. */
  last: LastDecision | null;
  /** The backlog's selected wave tab (a wave id): the table keeps only its findings. null = All. */
  wave: string | null;
  /** The wave composer: closed (null), or open for a new wave over `ids` / for editing wave `edit`. */
  composer: ComposerAsk | null;
}
/** What the wave composer opened for: `edit` the draft wave being changed (absent: a new wave), `ids` the findings it starts with. */
export interface ComposerAsk { edit?: string; ids: readonly string[] }
/** A decision that needs a note before it is sent (src/lib/train/rules.ts noteRequired). */
export interface NoteAsk { ids: readonly string[]; decision: Exclude<TriageDecision, 'reopen'>; at: 'bar' | 'compare' }
/** A triage decision the store answered: the items it moved and how (a reopen is not one: it clears `last`). */
export interface LastDecision { ids: readonly string[]; decision: Exclude<TriageResult['decision'], 'reopened'> }
export type LedgerScope = 'packs' | 'backlog';
export type CompareTheme = 'light' | 'dark' | 'both';
/** A compare screen mode: one of train/keymap.ts COMPARE_MODES (side, slider, blink, change map, changed area). */
export type CompareMode = (typeof COMPARE_MODES)[number]['value'];
export interface CompareView { theme: CompareTheme; mode: CompareMode }
export const EMPTY_UI: LedgerUi = {
  sel: new Set(), lens: new Set(), status: new Set(['proposed']), feat: new Set(), q: '', focus: null,
  scope: 'backlog', open: null, cmp: { theme: 'light', mode: 'side' }, wide: false, pending: new Map(), intents: new Map(), note: null, last: null, wave: null, composer: null,
};
export type SetUi = (f: (u: LedgerUi) => LedgerUi) => void;
/** The page state in another scope: its per-scope fields start over (the last decision too: Undo never reaches into a
 *  scope the person left). The same object when the scope is already that one. */
export const switchScope = (u: LedgerUi, scope: LedgerScope): LedgerUi =>
  u.scope === scope ? u : { ...u, scope, status: new Set(), focus: null, open: null, wide: false, note: null, last: null, composer: null };

// The page state, one per tab: a module store, so the ledger (desktop or phone), the Lenses panel and the plan's
// right-click menu read the same selection. `product` resets it when another product is shown.
let UI: { product: string; ui: LedgerUi } = { product: '', ui: EMPTY_UI };
const uiSubs = new Set<() => void>();
const subUi = (f: () => void) => { uiSubs.add(f); return () => { uiSubs.delete(f); }; };
const getUi = () => UI.ui;
const getIntents = () => UI.ui.intents;
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
  /** false while decisions are read-only (BP_WRITES=off): the dispatch controls are hidden. */
  writes: boolean;
  scan: ScanSnapshot | undefined;
  /** The packs, oldest first, each with its items (created order) and the ones the filters keep. */
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
  /** The product's waves (useWaves.ts). */
  waves: WavesModel;
  /** A finding's wave chip as strings, or undefined when no wave holds it. Stable until the waves change. */
  waveTag(id: string): { wave: string; pkg: string; model: string; effort: string } | undefined;
  /** The selection's dispatchable findings a new wave can take (none of them sits in a draft wave). */
  waveReady: readonly Finding[];
  /** The selection's dispatchable findings that a draft wave already holds, with that wave. */
  waveTaken: readonly { f: Finding; wave: Wave }[];
  /** Open the composer: for a new wave over `waveReady`, or (with `edit`) for that draft wave. */
  openComposer(edit?: string): void;
  closeComposer(): void;
  /** Select a wave's tab (null: All). */
  showWave(id: string | null): void;
  /** Dispatch a wave or some of its packages; the proposed ones read approved at once, a refusal rolls them back. */
  dispatchWave(id: string, packages?: string[]): Promise<WaveDispatchResult | null>;
}

export function lensMeta(P: ReturnType<typeof useEngine>['M']['P'], id: string): Omit<LensCol, 'n'> {
  const d = P.LENS[id];
  return d ? { id, short: d.short, name: d.name, glyph: d.glyph, enabled: d.i >= 0 } : { id, short: id.replace(/^.*\./, '').slice(0, 4).toUpperCase(), name: id, glyph: null, enabled: false };
}
const tidy = (s: string) => s.toLowerCase();

export function useLedger(ui: LedgerUi, set: SetUi): Ledger {
  const E = useEngine(), M = E.M, P = M.P, ctx = useScanCtx();
  const src = useFindings();
  // the dispatches in flight live in the module store (they outlive this component); `busy` only labels the buttons
  const intents = useSyncExternalStore(subUi, getIntents, getIntents);
  const [sending, setSending] = useState(0), busy = sending > 0, writes = useWritesOn();
  const waves = useWaves(ctx, src.jobs);
  // the store's own status per finding: the authority every intent is settled by
  const storeStatus = useMemo(() => new Map(src.proposals.map((p) => [p.id, p.status])), [src.proposals]);
  const statusRef = useRef<StatusOf>((id) => storeStatus.get(id));
  useEffect(() => {
    const of: StatusOf = (id) => storeStatus.get(id);
    statusRef.current = of;
    setLedgerUi((u) => { const n = settle(u.intents, of); return n === u.intents ? u : { ...u, intents: n }; });
  }, [storeStatus]);

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
    for (const j of src.jobs) if (holdsBuild(j)) for (const id of j.proposals ?? []) m.set(id, j);
    return m;
  }, [src.jobs]);

  const all = useMemo<Finding[]>(() => {
    const ev = rankValue(src.proposals);
    return src.proposals.map((p) => {
      const f = feats.get(p.feature), it = intents.get(p.id), status = overlay(p.status, it), job = jobOf.get(p.id) ?? null;
      return { p, status, fid: f?.fid ?? null, fname: f?.name ?? p.feature, domain: f?.domain ?? '', fi: f?.i ?? 1e6, job, ev: ev.get(p.id) ?? 0, can: canBuild(status, !!job) && !inFlight(p.status, it) };
    });
  }, [src.proposals, feats, intents, jobOf]);
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
  // the selected wave tab keeps its findings only (a wave the list does not have, yet or any more, filters nothing)
  const waveIds = useMemo(() => {
    const w = ui.wave ? waves.waves.find((x) => x.id === ui.wave) : undefined;
    return w ? new Set(w.packages.flatMap((p) => p.ids)) : null;
  }, [ui.wave, waves.waves]);
  const rows = useMemo(() => all.filter((f) => keep(f) && (!waveIds || waveIds.has(f.p.id)))
    // tier first (untriaged after tier 3, contract v4), then status rank, then value per effort
    .sort((a, b) => tierRank(a.p.tier) - tierRank(b.p.tier) || (rank.get(a.status) ?? STATUSES.length) - (rank.get(b.status) ?? STATUSES.length) || byRank(a, b)), [all, keep, rank, waveIds]);

  // the packs, oldest first (rules.ts byPackAge); a pack's items in created order (store.mjs `proposals --pack`), the kept ones beside them
  const packList = src.scan?.packs;
  const { items, packs } = useMemo(() => {
    const by = new Map<string, Finding[]>(), items: Finding[] = [];
    for (const f of all) if (f.p.pack_id) { let a = by.get(f.p.pack_id); if (!a) by.set(f.p.pack_id, (a = [])); a.push(f); items.push(f); }
    const order = [...(packList ?? [])].sort(byPackAge);
    const packs = order.map((pack) => {
      const its = (by.get(pack.id) ?? []).sort((a, b) => (a.p.created_at < b.p.created_at ? -1 : a.p.created_at > b.p.created_at ? 1 : a.p.id < b.p.id ? -1 : 1));
      return { pack, items: its, shown: its.filter(keep) };
    });
    return { items, packs };
  }, [all, packList, keep]);
  const scoped = useMemo(() => (ui.scope === 'packs' ? packs.flatMap((k) => k.shown) : rows), [ui.scope, packs, rows]);

  const ready = useMemo(() => all.filter((f) => f.can && ui.sel.has(f.p.id)), [all, ui.sel]);
  const { waveReady, waveTaken } = useMemo(() => {
    const ok: Finding[] = [], taken: { f: Finding; wave: Wave }[] = [];
    for (const f of ready) { const w = waves.draftOf.get(f.p.id); if (w) taken.push({ f, wave: w }); else ok.push(f); }
    return { waveReady: ok, waveTaken: taken };
  }, [ready, waves.draftOf]);
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

  // one send over the intent store: paint `ids` (each reads approved and cannot be sent again while in flight), arm the
  // bound, and hand back the withdrawal (compare-and-swap: only this send's entries the store has not moved, or `only`)
  const sendIntent = useCallback((ids: readonly string[]) => {
    const attempt = nextAttempt();
    setLedgerUi((u) => ({ ...u, intents: paint(u.intents, ids, statusRef.current, { attempt, at: Date.now(), shows: 'approved' }) }));
    setTimeout(() => {
      let expired: string[] = [];
      setLedgerUi((u) => {
        const e = expire(settle(u.intents, statusRef.current), Date.now(), INTENT_BOUND_MS);
        expired = e.expired.filter((id) => u.intents.get(id)?.attempt === attempt);
        return e.intents === u.intents ? u : { ...u, intents: e.intents };
      });
      if (expired.length) E.toast('Still waiting on the store', expired.join(', ') + (expired.length > 1 ? ': those dispatches' : ': that dispatch') + ' may still have landed. Check the row before dispatching again.', undefined, undefined, 'warn');
    }, INTENT_BOUND_MS);
    return (only?: Iterable<string>) => setLedgerUi((u) => { const n = revert(u.intents, attempt, statusRef.current, only); return n === u.intents ? u : { ...u, intents: n }; });
  }, [E]);

  const dispatchIds = useCallback(async (ids?: readonly string[]) => {
    if (E.refuseReadOnly()) return; // BP_WRITES=off: a key reached a control that is hidden
    const go = (ids ?? [...ui.sel]).map((id) => byId.get(id)).filter((f): f is Finding => !!f && f.can).map((f) => f.p.id);
    if (!go.length) { E.toast('Nothing to dispatch', 'select proposed or approved findings that no job is building'); return; }
    const withdraw = sendIntent(go);
    setSending((n) => n + 1);
    // /dispatch takes at most MAX_PROPOSALS (50) ids: one execute job per chunk (buildChunks), sent in order; the first
    // refusal stops the rest, and the toast says what went before it
    const jobs: string[] = [], sent = new Set<string>(), skipped: { id: string; status: string }[] = [];
    let built = 0;
    const line = () => 'execute job' + (jobs.length === 1 ? ' ' : 's ') + jobs.join(', ')
      + (skipped.length ? ' · ' + skipped.length + ' skipped (' + skipped.map((s) => s.id + ' ' + s.status).join(', ') + ')' : '');
    try {
      for (const part of buildChunks(go)) {
        const r = await dispatch(ctx, part);
        jobs.push(r.job.id); skipped.push(...r.skipped); built += r.job.proposals?.length ?? part.length;
        for (const id of part) sent.add(id);
      }
      if (skipped.length) withdraw(skipped.map((s) => s.id));
      E.toast('Dispatched ' + built + (built === 1 ? ' finding' : ' findings'), line());
    } catch (err) {
      // what was sent stays in flight; the unsent ids (and the skipped ones) go back to what the store says
      withdraw([...go.filter((id) => !sent.has(id)), ...skipped.map((s) => s.id)]);
      const why = err instanceof Error ? err.message : String(err);
      if (jobs.length) E.toast('Dispatch stopped after ' + built + ' of ' + go.length, line() + ' · then: ' + why);
      else E.toast('Dispatch failed', why);
    } finally {
      if (sent.size) set((u) => { const s = new Set(u.sel); for (const id of sent) s.delete(id); return { ...u, sel: s }; });
      setSending((n) => n - 1);
    }
  }, [ui.sel, byId, ctx, E, set, sendIntent]);

  const waveTags = useMemo(() => {
    const byWave = new Map(waves.waves.map((w) => [w.id, w]));
    const m = new Map<string, { wave: string; pkg: string; model: string; effort: string }>();
    for (const [id, at] of waves.waveOf) {
      const w = byWave.get(at.wave), p = w?.packages.find((x) => x.id === at.package);
      if (w && p) m.set(id, { wave: w.name, pkg: p.name, model: p.model, effort: p.effort });
    }
    return m;
  }, [waves.waves, waves.waveOf]);
  const waveTag = useCallback((id: string) => waveTags.get(id), [waveTags]);
  const openComposer = useCallback((edit?: string) => {
    const w = edit ? waves.waves.find((x) => x.id === edit) : undefined;
    if (edit && !w) return;
    const ids = w ? w.packages.flatMap((p) => p.ids) : waveReady.map((f) => f.p.id);
    if (!ids.length) { E.toast('Nothing to add', 'select proposed or approved findings that no draft wave holds'); return; }
    set((u) => ({ ...u, composer: w ? { edit: w.id, ids } : { ids } }));
  }, [waves.waves, waveReady, E, set]);
  const closeComposer = useCallback(() => set((u) => (u.composer ? { ...u, composer: null } : u)), [set]);
  const showWave = useCallback((id: string | null) => set((u) => (u.wave === id ? u : { ...u, wave: id, focus: null })), [set]);

  const dispatchWave = useCallback(async (id: string, packages?: string[]): Promise<WaveDispatchResult | null> => {
    const w = waves.waves.find((x) => x.id === id);
    const go = (w?.packages ?? []).filter((p) => !packages || packages.includes(p.id)).flatMap((p) => p.ids).map((i) => byId.get(i)).filter((f): f is Finding => !!f && f.can);
    if (!w || !go.length) { E.toast('Nothing to dispatch', 'every finding of ' + (packages ? 'that package' : 'this wave') + ' is built, building or no longer open'); return null; }
    const withdraw = sendIntent(go.map((f) => f.p.id));
    setSending((n) => n + 1);
    try {
      const r = await waves.dispatch(id, packages);
      if (!r) { withdraw(); return r; }
      if (r.skipped.length) withdraw(r.skipped.map((s) => s.id));
      E.toast('Dispatched ' + w.name, r.jobs.length + (r.jobs.length === 1 ? ' execute job' : ' execute jobs') + (r.skipped.length ? ' · ' + r.skipped.length + ' skipped' : ''));
      return r;
    } catch (err) { withdraw(); throw err; } finally { setSending((n) => n - 1); }
  }, [waves, byId, E, sendIntent]);

  const showInTable = useCallback((slug: string) => {
    set((u) => ({ ...u, feat: new Set([slug]), focus: null }));
    E.setPage('ledger', 'triage');
  }, [E, set]);

  const openFeature = useCallback((f: Finding) => {
    if (!f.fid) { E.toast('Not on the plan', f.p.feature + ' is not a feature of this map'); return; }
    E.setPage('plan');
    E.setView(isView(P, f.p.lens) ? f.p.lens : GENERAL);
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
  const setScope = useCallback((scope: LedgerScope) => set((u) => switchScope(u, scope)), [set]);

  return { ui, set, all, byId, rows, lenses, counts, ready, effort, busy, writes, scan: moveScan, packs, items, chips, scoped, setScope, toggle, select, selectWhere, clear, setFocus, dispatchIds, showInTable, openFeature, move, order, waves, waveTag, waveReady, waveTaken, openComposer, closeComposer, showWave, dispatchWave };
}

// ------------------------------------------------------------------------------------------- the matrix's rows
/** The matrix's rows: one per feature with findings, in map order. */
export function matrixRows(rows: readonly Finding[]): { slug: string; name: string; domain: string; items: Finding[] }[] {
  const m = new Map<string, { slug: string; name: string; domain: string; fi: number; items: Finding[] }>();
  for (const f of rows) { let r = m.get(f.p.feature); if (!r) m.set(f.p.feature, (r = { slug: f.p.feature, name: f.fname, domain: f.domain, fi: f.fi, items: [] })); r.items.push(f); }
  return [...m.values()].sort((a, b) => a.fi - b.fi || (a.slug < b.slug ? -1 : 1));
}
