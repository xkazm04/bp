// The one way the UI starts, dispatches and cancels scan work. A live product goes to its localhost
// routes (the server spawns the Claude Code CLI); the Kettle sample goes to the scan sim. Callers never
// branch on which.
import type { ScanSim } from '@/lib/model/scan-sim';
import type { ScanJob, ScanScope } from './jobs';
import type { LensEntry, LensManifest } from '@/lib/standard/types';
import { deleteJob, executeLens, postDispatch, postProjectLens, postScan, type LensExecuteResult } from './client';

export interface ScanCtx {
  /** The live product's slug; null for the Kettle sample. */
  slug: string | null;
  /** The Kettle scan sim; null for a live product. */
  sim: ScanSim | null;
}

export interface DispatchResult { job: ScanJob; approved: string[]; skipped: { id: string; status: string }[] }

const nowhere = () => Object.assign(new Error('Nothing to scan with: no live product and no sample sim'), { status: 503 });

/** Start a measure scan of one lens over a scope. Rejects with an Error carrying `status` on a refusal. */
export async function startScan(ctx: ScanCtx, lens: string, scope: ScanScope): Promise<ScanJob> {
  if (ctx.slug) return postScan(ctx.slug, lens, scope);
  if (ctx.sim) return ctx.sim.startScan(lens, scope);
  throw nowhere();
}

/** Approve the proposed ones among `ids` and start one execute run over all of them. */
export async function dispatch(ctx: ScanCtx, ids: string[]): Promise<DispatchResult> {
  if (ctx.slug) return postDispatch(ctx.slug, ids);
  if (ctx.sim) return ctx.sim.dispatch(ids);
  throw nowhere();
}

/** Measure one lens over exactly `features` (the ledger's selection, 1..MAX_SELECTION slugs): a `selection` scope.
 *  S0 STUB: WP4 implements the live route and the Kettle sim. */
export async function startSelectionScan(ctx: ScanCtx, lens: string, features: string[]): Promise<ScanJob> {
  return startScan(ctx, lens, { kind: 'selection', label: 'Selection (' + features.length + ')', features });
}

/** Execute a lens's backlog: approve its proposed findings, build them with its approved ones, in jobs of at most 50.
 *  S0 STUB: WP4 implements the Kettle sim branch. */
export async function executeLensBacklog(ctx: ScanCtx, lens: string): Promise<LensExecuteResult> {
  if (ctx.slug) return executeLens(ctx.slug, lens);
  throw nowhere();
}

/** Add a lens to the product: a permanent project lens (reverse-DNS id) or, with `temporary`, a tmp.* lens. Kettle
 *  keeps it in localStorage. S0 STUB: WP4 implements the Kettle branch. */
export async function addProjectLens(ctx: ScanCtx, manifest: LensManifest, temporary = false): Promise<LensEntry> {
  if (ctx.slug) return postProjectLens(ctx.slug, manifest, temporary);
  throw nowhere();
}

export async function cancelJob(ctx: ScanCtx, id: string): Promise<ScanJob> {
  if (ctx.slug) return deleteJob(ctx.slug, id);
  if (ctx.sim) return ctx.sim.cancel(id);
  throw nowhere();
}

const REFUSAL: Record<string, string> = {
  'unknown-lens': 'that lens is not enabled in the map',
  'no-scan-method': 'that lens has no scan method (no built-in and no manifest scan block)',
  'bad-scope': 'the scope names a place or feature the map does not have',
  'queue-full': '16 scans are already queued',
};
/** A refusal in words for a toast: the route's or the sim's error code explained, else its text. */
export function refusalText(e: unknown): string {
  const msg = (e as Error | undefined)?.message || String(e);
  return REFUSAL[msg] ?? msg;
}
