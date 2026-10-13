// The Kettle sample's stand-in for the Claude Code CLI: scans and execute runs that play out in the
// browser and emit the same store rows a real lens-scan run writes, so the model applies them on the
// live path (applyScan) and every scan view is shared with live products.
import type { Proposal, ScanSnapshot } from '@/lib/scan/types';
import type { ScanJob, ScanScope } from '@/lib/scan/jobs';

export class ScanSim {
  constructor(opts: { now: () => number; findings: readonly Proposal[] }) { void opts; }
  /** Every job so far, oldest first. */
  jobs(): readonly ScanJob[] { return []; }
  /** The synthetic store so far: runs, measurements, activity and the findings' current states. */
  snapshot(): ScanSnapshot { return { runs: [], measurements: [], proposals: [], activity: [], shots: [], coverage: [] }; }
  startScan(lens: string, scope: ScanScope): ScanJob { void lens; void scope; throw new Error('ScanSim: not built yet (WP3)'); }
  dispatch(ids: string[]): { job: ScanJob; approved: string[]; skipped: { id: string; status: string }[] } { void ids; throw new Error('ScanSim: not built yet (WP3)'); }
  cancel(id: string): ScanJob { void id; throw new Error('ScanSim: not built yet (WP3)'); }
  /** Called on change (a job moved, rows were added). Returns the unsubscribe. */
  subscribe(fn: () => void): () => void { void fn; return () => {}; }
  dispose(): void {}
}
