// Wire types for the lens-scan store: one SQLite file per product repo, `<root>/.ai/lens-scan/scan.db`,
// written by the /lens-scan skill and read (plus proposal decisions) by the blueprint's routes. The
// DDL is docs/standard/lens-scan-store.md, name for name. Absent values are omitted, never null or 0:
// no measurement row means "unmeasured".
import type { MetricMethod } from '@/lib/standard/types';

export type RunPhase = 'measure' | 'propose' | 'execute' | 'propagate';
export type RunStatus = 'running' | 'done' | 'failed' | 'aborted';
export type ProposalKind = 'fix' | 'baseline-upgrade' | 'propagation';
export type ProposalStatus = 'proposed' | 'approved' | 'declined' | 'executing' | 'done' | 'failed';
export type ProposalSize = 'XS' | 'S' | 'M' | 'L' | 'XL';
export type ActivityKind = 'reading' | 'measured' | 'proposed' | 'executing' | 'committed' | 'note' | 'error';
export type CoverageState = 'conformant' | 'deviation' | 'not-applicable' | 'unknown';

export interface Run {
  id: string;
  started_at: string;
  updated_at: string;
  ended_at?: string;
  phase: RunPhase;
  status: RunStatus;
  /** Lens ids the run covers. */
  lenses: string[];
  /** What the run was pointed at, e.g. `{ group: "Agent Platform" }`. */
  scope?: Record<string, unknown>;
  skill_version?: string;
  model?: string;
  note?: string;
}

/** Append-only: one row per reading. `metric` is the lens field key. */
export interface Measurement {
  id: number;
  run_id: string;
  feature: string;
  lens: string;
  metric: string;
  value: number;
  unit?: string;
  method?: MetricMethod;
  evidence?: string;
  measured_at: string;
}

/**
 * A backlog item. `standard` is `<subject>/<technique>` (registry), `house:<subject>/<technique>`, or
 * `none`. A propagation item has `parent_id` = the baseline upgrade that spawned it.
 */
export interface Proposal {
  id: string;
  run_id: string;
  feature: string;
  lens: string;
  metric?: string;
  title: string;
  /** Markdown: Summary / Description / Flow / Expected impact / Evaluation. */
  body?: string;
  standard: string;
  expected_delta?: number;
  size?: ProposalSize;
  /** 1-10. */
  risk?: number;
  kind: ProposalKind;
  parent_id?: string;
  status: ProposalStatus;
  decided_by?: string;
  decided_at?: string;
  decision_note?: string;
  after_value?: number;
  result_sha?: string;
  created_at: string;
  updated_at: string;
}

export interface Activity {
  id: number;
  run_id: string;
  at: string;
  feature?: string;
  lens?: string;
  kind: ActivityKind;
  text: string;
}

export interface Shot {
  id: number;
  run_id: string;
  feature: string;
  /** Relative to the store directory: `shots/<feature>/<run>-<size>-<theme>.png`. */
  path: string;
  size?: string;
  theme?: string;
  harness_module?: string;
  captured_at: string;
  /** The harness report for this shot (console errors, unknown IPC, text checks). */
  report?: Record<string, unknown>;
}

export interface Coverage {
  feature: string;
  standard: string;
  state: CoverageState;
  evidence?: string;
  judged_at: string;
  run_id?: string;
}

/** Everything the UI needs, on connect. `activity` is the latest 200 rows. */
export interface ScanSnapshot {
  runs: Run[];
  measurements: Measurement[];
  proposals: Proposal[];
  activity: Activity[];
  shots: Shot[];
  coverage: Coverage[];
}
/** New or changed rows since the last delta; same keys as the snapshot. */
export type ScanDelta = ScanSnapshot;

/** One line of `bp.products.local.json` (gitignored). Kettle is built in and never listed. */
export interface ProductEntry {
  slug: string;
  name: string;
  /** Absolute path of the product repo. */
  root: string;
}
/** `GET /api/products`. */
export interface ProductInfo {
  slug: string;
  name: string;
  /** true = the repo has a lens-scan store. */
  live: boolean;
}

export type Decision = 'approve' | 'decline';
/** `POST /api/products/[slug]/proposals/[id]` body. */
export interface DecisionBody {
  decision: Decision;
  note?: string;
}

/** The SSE event names of `GET /api/products/[slug]/stream`. */
export type StreamEvent = 'snapshot' | 'delta' | 'ping';
