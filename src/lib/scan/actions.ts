// The one way the UI starts, dispatches and cancels scan work. A live product goes to its localhost
// routes (the server spawns the Claude Code CLI); the Kettle sample goes to the scan sim. Callers never
// branch on which.
import type { ScanSim } from '@/lib/model/scan-sim';
import type { ScanJob, ScanScope } from './jobs';

export interface ScanCtx {
  /** The live product's slug; null for the Kettle sample. */
  slug: string | null;
  /** The Kettle scan sim; null for a live product. */
  sim: ScanSim | null;
}

export interface DispatchResult { job: ScanJob; approved: string[]; skipped: { id: string; status: string }[] }

/** Start a measure scan of one lens over a scope. Rejects with an Error carrying `status` on a refusal. */
export async function startScan(ctx: ScanCtx, lens: string, scope: ScanScope): Promise<ScanJob> {
  void ctx; void lens; void scope;
  throw new Error('startScan: not built yet (spark scan-package WP3)');
}

/** Approve the proposed ones among `ids` and start one execute run over all of them. */
export async function dispatch(ctx: ScanCtx, ids: string[]): Promise<DispatchResult> {
  void ctx; void ids;
  throw new Error('dispatch: not built yet (spark scan-package WP3)');
}

export async function cancelJob(ctx: ScanCtx, id: string): Promise<ScanJob> {
  void ctx; void id;
  throw new Error('cancelJob: not built yet (spark scan-package WP3)');
}
