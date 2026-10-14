'use client';
// What the Lenses panel, the ledger's lens chip menu, "Scan selected features" and the plan's right-click share:
// every lens of the product as rows, per lens the open findings, the backlog and the job on it, and the scan and
// execute actions with their toasts. Nothing here branches on a lens id; the live / Kettle split is actions.ts's,
// except the enable and delete writes (as the temporary-lens panel had them).
//
// Where the rows come from:
//   the model's every lens entry (E.M.P.base.allLenses: enabled or not, in the map's order), then
//   entries the model does not have yet (a lens just added: the app rebuilds for the new lens set a moment later):
//     live product: the map's `lenses[]` (useLive().product.structure, refreshed by the stream's `map` event);
//     Kettle:       this browser's store (src/lib/scan/temp-lens.ts), through its subscription.
import { useMemo, useSyncExternalStore } from 'react';
import type { Engine } from '@/engine/Engine';
import type { LensDef } from '@/lib/standard/load';
import type { LensEntry, LensManifest } from '@/lib/standard/types';
import { executeLensBacklog, refusalText, startScan, startSelectionScan, type ScanCtx } from '@/lib/scan/actions';
import { MAX_SELECTION, scannable, type ScanJob, type ScanScope } from '@/lib/scan/jobs';
import { readTempLenses, subscribeTempLenses } from '@/lib/scan/temp-lens';
import { useEngine, useLive } from '../../hooks';
import { useFindings } from '../useLedger';

/** The execute route builds a lens's backlog in jobs of at most this many findings. */
export const EXEC_BATCH = 50;
const EVERYTHING: ScanScope = { kind: 'all', label: 'Everything', features: [] };

export type LensKind = 'built-in' | 'project' | 'temporary';
export interface LensRow {
  id: string;
  /** The model's lens; null while the app has not rebuilt for a lens just added. */
  def: LensDef | null;
  manifest: LensManifest;
  kind: LensKind;
  enabled: boolean;
  created_at?: string;
  /** Kettle only: the browser's store holds the entry (so it can be enabled, disabled or deleted here). */
  stored: boolean;
}

const NONE: readonly LensEntry[] = [];
const noStore = () => NONE as LensEntry[];

/** Every lens of the product in the map's order, and the live slug (null = Kettle). */
export function useLensRows(): { slug: string | null; rows: readonly LensRow[] } {
  const E = useEngine(), live = useLive(), slug = live?.slug ?? null, P = E.M.P;
  const stored = useSyncExternalStore(subscribeTempLenses, slug ? noStore : readTempLenses, noStore);
  const entries = slug ? live?.product.structure?.lenses ?? NONE : stored;
  const rows = useMemo(() => {
    const by = new Map(entries.map((e) => [e.id, e])), kettle = new Set(slug ? [] : stored.map((e) => e.id));
    const kindOf = (source: string, temporary: boolean | undefined): LensKind => (source === 'builtin' ? 'built-in' : temporary ? 'temporary' : 'project');
    const out: LensRow[] = P.base.allLenses.map((d) => {
      const e = by.get(d.id);
      return { id: d.id, def: d, manifest: d.manifest, kind: kindOf(d.source, e?.temporary ?? d.temporary), enabled: e ? e.enabled : d.i >= 0, created_at: e?.created_at, stored: kettle.has(d.id) };
    });
    for (const e of entries) if (!P.LENS[e.id]) out.push({ id: e.id, def: null, manifest: e.manifest, kind: kindOf(e.source, e.temporary), enabled: e.enabled, created_at: e.created_at, stored: kettle.has(e.id) });
    return out;
  }, [P, entries, stored, slug]);
  return { slug, rows };
}

/** Per lens: open (proposed) findings, the backlog an execute would build (proposed or approved, no job on it), and a
 *  queued or running job on the lens (a measure of it, or an execute over its findings). */
export interface LensStat { open: number; backlog: number; job: ScanJob | null }
const ZERO: LensStat = { open: 0, backlog: 0, job: null };
const active = (j: ScanJob) => j.status === 'queued' || j.status === 'running';

export function useLensStats(): { get(id: string): LensStat } {
  const { proposals, jobs } = useFindings();
  return useMemo(() => {
    const lensOf = new Map(proposals.map((p) => [p.id, p.lens])), building = new Set<string>(), m = new Map<string, LensStat>();
    const at = (id: string) => { let s = m.get(id); if (!s) m.set(id, (s = { open: 0, backlog: 0, job: null })); return s; };
    for (const j of jobs) {
      if (!active(j)) continue;
      if (j.kind === 'measure' && j.lens) { const s = at(j.lens); if (!s.job || j.status === 'running') s.job = j; }
      if (j.kind === 'execute') for (const id of j.proposals ?? []) {
        building.add(id);
        const l = lensOf.get(id); if (l) { const s = at(l); if (!s.job) s.job = j; }
      }
    }
    for (const p of proposals) {
      if (p.status === 'proposed') at(p.lens).open++;
      if ((p.status === 'proposed' || p.status === 'approved') && !building.has(p.id)) at(p.lens).backlog++;
    }
    return { get: (id: string) => m.get(id) ?? ZERO };
  }, [proposals, jobs]);
}

/** Why a lens cannot be scanned now, or null: not on the plan, disabled, or no scan method (live). */
export function scanBlock(r: Pick<LensRow, 'id' | 'manifest' | 'enabled' | 'def'>, sim: boolean): string | null {
  if (!r.enabled) return 'Enable the lens first';
  if (!r.def) return 'The plan does not have this lens yet';
  if (!scannable({ id: r.id, manifest: r.manifest }, sim)) return 'This lens has no scan method: no built-in and no manifest scan block';
  return null;
}

/** Start a measure scan of one lens over every feature; the outcome is a toast (a refusal says why). */
export async function scanNow(E: Engine, ctx: ScanCtx, id: string, name: string): Promise<void> {
  try {
    await startScan(ctx, id, EVERYTHING);
    E.toast(`Scanning ${name}`, 'every feature; readings fill the plan as they come');
  } catch (e) {
    E.toast(`Could not start the ${name} scan:`, refusalText(e));
  }
}

/** One `selection` scan per lens over the same features (capped at MAX_SELECTION); one toast for all of them. */
export async function scanSelection(E: Engine, ctx: ScanCtx, lenses: readonly { id: string; name: string }[], features: readonly string[]): Promise<void> {
  const fs = features.slice(0, MAX_SELECTION), cut = features.length > fs.length ? ' · the first ' + MAX_SELECTION + ' of ' + features.length : '';
  if (!lenses.length || !fs.length) return;
  const rs = await Promise.allSettled(lenses.map((l) => startSelectionScan(ctx, l.id, fs)));
  const bad = rs.map((r, i) => (r.status === 'rejected' ? lenses[i].name + ': ' + refusalText(r.reason) : null)).filter((x): x is string => !!x);
  const n = rs.length - bad.length;
  if (bad.length) E.toast(n ? 'Some scans did not start' : 'Scan not started', bad.join('; '));
  else E.toast(n === 1 ? 'Scanning ' + lenses[0].name : 'Scanning ' + n + ' lenses', 'Selection (' + fs.length + ') · ' + fs.length + (fs.length === 1 ? ' feature' : ' features') + cut);
}

/** Approve the lens's proposed findings and build them with its approved ones (jobs of EXEC_BATCH); a toast says what
 *  went. Resolves true when jobs started. */
export async function executeBacklog(E: Engine, ctx: ScanCtx, id: string, name: string): Promise<boolean> {
  try {
    const r = await executeLensBacklog(ctx, id);
    const built = r.jobs.reduce((s, j) => s + (j.proposals?.length ?? 0), 0);
    E.toast(`Building the ${name} backlog`, `${built || r.approved.length} findings in ${r.jobs.length} ${r.jobs.length === 1 ? 'job' : 'jobs'}`
      + (r.approved.length ? ` · ${r.approved.length} approved` : '') + (r.skipped.length ? ` · ${r.skipped.length} skipped (${r.skipped.slice(0, 4).map((s) => s.id + ' ' + s.status).join(', ')}${r.skipped.length > 4 ? ', …' : ''})` : ''));
    return r.jobs.length > 0;
  } catch (e) {
    E.toast(`Could not execute the ${name} backlog:`, refusalText(e));
    return false;
  }
}

/** "Approve and build n findings in k jobs?" */
export const executeAsk = (n: number) => `Approve and build ${n} ${n === 1 ? 'finding' : 'findings'} in ${Math.ceil(n / EXEC_BATCH)} ${Math.ceil(n / EXEC_BATCH) === 1 ? 'job' : 'jobs'}?`;
