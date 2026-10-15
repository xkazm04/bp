// Wire types for the lens-scan store: one SQLite file per product repo, `<root>/.ai/lens-scan/scan.db`,
// written by the /lens-scan skill and read (plus proposal decisions) by the blueprint's routes. The
// DDL is docs/standard/lens-scan-store.sql, name for name. Absent values are omitted, never null or 0:
// no measurement row means "unmeasured".
import type { MetricMethod } from '@/lib/standard/types';
import type { Readiness } from './readiness';

export type RunPhase = 'measure' | 'propose' | 'execute' | 'propagate';
export type RunStatus = 'running' | 'done' | 'failed' | 'aborted';
export type ProposalKind = 'fix' | 'baseline-upgrade' | 'propagation';
/** v2 adds a person's triage of a built item (accepted, rework, descoped) and `released` (its release was tagged). */
export type ProposalStatus = 'proposed' | 'approved' | 'declined' | 'executing' | 'done' | 'failed' | 'accepted' | 'rework' | 'descoped' | 'released';
export type ProposalSize = 'XS' | 'S' | 'M' | 'L' | 'XL';
export type ActivityKind = 'reading' | 'measured' | 'proposed' | 'executing' | 'committed' | 'note' | 'error';
export type CoverageState = 'conformant' | 'deviation' | 'not-applicable' | 'unknown';
/** v2: a reading or a capture taken for one proposal, before or after its build. */
export type EvidencePhase = 'before' | 'after';
export type PackStatus = 'open' | 'triaged' | 'closed';
export type ReleaseStatus = 'draft' | 'building' | 'pr-open' | 'merged' | 'tagged' | 'failed';
/** A person's call on a built item (`POST /api/products/[slug]/triage`). `reopen` (v3) takes an accepted, rework or
 *  descoped item back to the status it had before (its `triaged_from`) while its release is still a draft: the undo. */
export type TriageDecision = 'accept' | 'rework' | 'descope' | 'reopen';

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
  /** v2: the proposal this reading is before/after evidence for (with `phase`). An `after` reading was taken on the
   *  pack branch, so it never counts as the feature's current state (src/lib/scan/derive.ts isCurrent). */
  proposal_id?: string;
  phase?: EvidencePhase;
  /** v2: the commit the reading was taken on. */
  commit_sha?: string;
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
  /** v2: the pack that built it. */
  pack_id?: string;
  /** v2: the item's own squashed commit on its pack branch. */
  commit_sha?: string;
  /** v2: the previous attempt, when this row is a rework rebuild. */
  attempt_of?: string;
  /** v2: the release it ships in. */
  release_id?: string;
  triage_note?: string;
  /** v3: the status the item had before its latest triage, so `reopen` can put it back. */
  triaged_from?: ProposalStatus;
  /** `<kind>:<name>`, e.g. `user:octocat`. */
  triaged_by?: string;
  triaged_at?: string;
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
  /** Relative to the store directory: `shots/<run>/<feature>-<theme>-<size>.png`. */
  path: string;
  size?: string;
  theme?: string;
  harness_module?: string;
  captured_at: string;
  /** The harness report for this shot (console errors, unknown IPC, text checks). */
  report?: Record<string, unknown>;
  /** v2: the proposal this capture is before/after evidence for (with `phase`). */
  proposal_id?: string;
  phase?: EvidencePhase;
}

/** v2: one lens's built items on one branch, `pack/<short>-<n>`, cut from `base_ref` at `base_sha`. */
export interface Pack {
  /** `k-<short>-<n>`, e.g. `k-des-3`. */
  id: string;
  lens: string;
  /** Per-lens counter, 1-based. */
  n: number;
  branch: string;
  base_ref: string;
  base_sha: string;
  /** The execute run that built it. */
  run_id?: string;
  status: PackStatus;
  created_at: string;
  updated_at: string;
}

/** v2: accepted items cherry-picked onto `release/<version>`, a PR, then the tag `v<version>`. */
export interface Release {
  /** `rel-<version>`. */
  id: string;
  /** Semver without the v. */
  version: string;
  branch: string;
  base_sha?: string;
  status: ReleaseStatus;
  pr_url?: string;
  tag?: string;
  /** Markdown release notes. */
  notes?: string;
  error?: string;
  created_by?: string;
  created_at: string;
  updated_at: string;
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
  /** v2 (empty on a v1 store). */
  packs: Pack[];
  /** v2, oldest first (empty on a v1 store). */
  releases: Release[];
}
/** New or changed rows since the last delta; same keys as the snapshot. */
export type ScanDelta = ScanSnapshot;

/** The snapshot's tables. A Record over `keyof ScanSnapshot`, so a table added above fails to compile until it is listed here. */
const TABLE_SET: Record<keyof ScanSnapshot, true> = { runs: true, measurements: true, proposals: true, activity: true, shots: true, coverage: true, packs: true, releases: true };
export const SCAN_TABLES = Object.keys(TABLE_SET) as readonly (keyof ScanSnapshot)[];
/** Every table present and empty. */
export function emptyScan(): ScanSnapshot {
  const s = {} as Record<keyof ScanSnapshot, unknown[]>;
  for (const t of SCAN_TABLES) s[t] = [];
  return s as ScanSnapshot;
}
/** A wire snapshot with every table present (a store being created may send only some). */
export function fullScan(x: Partial<ScanSnapshot>): ScanSnapshot {
  const s = emptyScan() as Record<keyof ScanSnapshot, unknown[]>;
  for (const t of SCAN_TABLES) if (Array.isArray(x[t])) s[t] = x[t];
  return s as ScanSnapshot;
}
export const isEmptyScan = (s: ScanSnapshot): boolean => SCAN_TABLES.every((t) => s[t].length === 0);

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
  /** The repo root, resolved to an absolute path. */
  root: string;
  /** true = the repo has a lens-scan store. */
  live: boolean;
  /** What the repo has of the files a live product needs (src/lib/scan/readiness.ts). */
  readiness: Readiness;
}

export type Decision = 'approve' | 'decline';
/** `POST /api/products/[slug]/proposals/[id]` body. */
export interface DecisionBody {
  decision: Decision;
  note?: string;
}

/** `POST /api/products/[slug]/triage` body. */
export interface TriageBody {
  ids: string[];
  decision: TriageDecision;
  note?: string;
}
/** What store.mjs `triage` answers (and the triage route returns). */
export interface TriageResult {
  /** The status the items moved to; `reopened` when each went back to its own `triaged_from`. */
  decision: 'accepted' | 'rework' | 'descoped' | 'reopened';
  by: string;
  triaged: string[];
  /** Items left as they were: their status, and a reason (`note-required`, `in-release`) where the status alone does not say why. */
  skipped: { id: string; status: string; reason?: string }[];
  /** Packs that moved open -> triaged in the same transaction. */
  packs_triaged: string[];
  /** v3, reopen only: packs that moved triaged -> open because an item went back to waiting. */
  packs_reopened?: string[];
}
/** `POST /api/products/[slug]/releases` (201): the draft with its items, and what release-add left out. */
export interface ReleaseCreated {
  release: Release & { items: Proposal[] };
  added: string[];
  skipped: { id: string; status: string; reason?: string }[];
}
/** `GET /api/products/[slug]/commits/[sha]`: one item commit, for the ledger's compare panel. `patch` is cut at
 *  2000 lines (`truncated`); `lines` is the full count. */
export interface CommitDiff {
  sha: string;
  /** The full commit message, trailers included. */
  message: string;
  /** `git show --stat` as git prints it. */
  stat: string;
  files: { path: string; add: number; del: number }[];
  patch: string;
  lines: number;
  truncated: boolean;
}
/** `GET /api/products/[slug]/releases/suggest`. */
export interface VersionSuggestion {
  /** Semver without the v. */
  version: string;
  /** What it was derived from: the latest tag (`v1.4.0`), a manifest (`package.json`, `src-tauri/Cargo.toml`), or `none`. */
  from: string;
  reason: string;
}

/** The SSE event names of `GET /api/products/[slug]/stream`. */
export type StreamEvent = 'snapshot' | 'delta' | 'map' | 'ping' | 'error' | 'jobs';
