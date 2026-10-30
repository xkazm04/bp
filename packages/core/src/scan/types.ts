// Wire types for the lens-scan store: one SQLite file per product repo, `<root>/.ai/lens-scan/scan.db`,
// written by the /lens-scan skill and read (plus proposal decisions) by the blueprint's routes. The
// DDL is docs/standard/lens-scan-store.sql, name for name. Absent values are omitted, never null or 0:
// no measurement row means "unmeasured". v5 adds the scan-finding/1 columns (score, band, mvp, predicted verdict,
// veto window, proof) and the trust_events table; a v4 store reads with those keys absent and trust_events empty.
import type { MetricMethod } from '@bp/core/standard/types';
import type { Readiness } from './readiness';
import type { LensSetupNeed } from './lens-setup';

export type RunPhase = 'measure' | 'propose' | 'execute' | 'propagate';
export type RunStatus = 'running' | 'done' | 'failed' | 'aborted';
export type ProposalKind = 'fix' | 'baseline-upgrade' | 'propagation' | 'work-item';
/** v4: where a backlog item came from. */
export type ProposalOrigin = 'scan' | 'ado' | 'sweep';
/** v4: what kind of harm the problem is. */
export type RiskClass = 'secret' | 'authz' | 'money' | 'data' | 'llm' | 'perf' | 'reliability' | 'ux' | 'debt';
/** v4: how bad the problem is: 0 stop-ship, 1 before production, 2 soon after, 3 backlog. */
export type Tier = 0 | 1 | 2 | 3;
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
  /** v4: omitted = 'scan'; only an imported item carries it. */
  origin?: ProposalOrigin;
  /** v4: '<origin>:<id>' in the source system, e.g. 'ado:1234'. */
  external_ref?: string;
  external_url?: string;
  /** v4: severity; omitted = untriaged. Not the same as risk (the risk of the change). */
  tier?: Tier;
  risk_class?: RiskClass;
  ranked_by?: string;
  ranked_at?: string;
  // v5: scan-finding/1 (docs/standard/lens-scan-store.sql, the contract's "Fields every finding carries"). The skill stores
  // them; the blueprint reads them and never recomputes `score`. A v4 store has none of these keys.
  /** v5: 1-10, the severity of a defect or the value of an opportunity. */
  impact?: number;
  /** v5: the one-line reason for `impact`. */
  impact_why?: string;
  confidence?: Confidence;
  /** v5: 1-10 build effort. */
  effort?: number;
  /** v5: scan-score/1, one decimal, stored by the skill. Omitted = unscored (impact or effort unknown): never 0. */
  score?: number;
  score_parts?: ScoreParts;
  /** v5: omitted = 'ranked' (the store's default, like origin's 'scan'); 'reserve' = verified and scored, over the run's cap. */
  band?: Band;
  /** v5: true on the top finding of its lens in its run; omitted = false (the store's default 0). */
  mvp?: true;
  mvp_rule?: MvpRule;
  /** v5: why the MVP is not the top score (with mvp_rule 'override'). */
  mvp_why?: string;
  category?: FindingCategory;
  /** v5: the model's verdict, recorded before any person decided (shadow mode). */
  predicted_verdict?: PredictedVerdict;
  predicted_why?: string;
  /** v5: `<skill>@<version>:<model>`. */
  predicted_by?: string;
  predicted_at?: string;
  /** v5: set when a machine decided under L1 (`decided_by` 'machine:lens-scan'): a person may veto it until then. */
  veto_until?: string;
  proof?: Proof;
}

/** v5 (scan-finding/1). */
export type Confidence = 'low' | 'medium' | 'high';
export type Band = 'ranked' | 'reserve';
export type MvpRule = 'top-score' | 'override';
export type FindingCategory = 'technical' | 'product';
export type PredictedVerdict = 'accept' | 'reject' | 'defer';
export type ProofVerdict = 'better' | 'not-better' | 'inconclusive';
/** v5: the score's breakdown, shipped with the number (`formula` names it: 'scan-score/1'). */
export interface ScoreParts {
  impact?: number;
  confidence_w?: number;
  effort_div?: number;
  risk_factor?: number;
  formula?: string;
}
/** v5: a built change's before/after under one method, with its control (`red` = the control proved the gate bites). */
export interface Proof {
  metric?: string;
  method?: string;
  unit?: string;
  before?: number;
  after?: number;
  verdict?: ProofVerdict;
  control?: 'red' | 'absent';
  base_sha?: string;
  head_sha?: string;
}
/** v5: one row of the append-only autonomy ledger. `slice` = '<category>|<lens>|<risk_class>|<size>', '-' for an absent part;
 *  levels 0 propose, 1 auto-triage, 2 auto-build with proof, 3 auto-merge. The blueprint reads it and never writes it. */
export interface TrustEvent {
  id: number;
  at: string;
  slice: string;
  from_level: number;
  to_level: number;
  /** 'promote: agreement' | 'demote: reversal <id>' | 'demote: not-better <id>' | 'overlay: <key>'. */
  reason: string;
  /** 0..1 over the window, when computed. */
  agreement?: number;
  /** Human-decided items in the window. */
  n?: number;
  /** The item that caused a demotion. */
  item_id?: string;
}
/** `POST /api/products/[slug]/proposals/[id]/veto` body: a person reverses a machine decision inside its veto window. */
export interface VetoBody { reason: string }

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
  /** v5, oldest first (empty on a v4 store). Optional on the wire only for a sender older than v5: every snapshot this
   *  repo builds (emptyScan) carries it. */
  trust_events?: TrustEvent[];
}
/** New or changed rows since the last delta; same keys as the snapshot. */
export type ScanDelta = ScanSnapshot;

/** The snapshot's tables. A Record over `keyof ScanSnapshot`, so a table added above fails to compile until it is listed here. */
const TABLE_SET: Record<keyof ScanSnapshot, true> = { runs: true, measurements: true, proposals: true, activity: true, shots: true, coverage: true, packs: true, releases: true, trust_events: true };
/** Most ids one triage (or release-add) body may name. One value: the route and the store call (release.server.ts), the sample
 *  sim (train-sim.ts) and the ledger's decision path (Decide.tsx) all take it from here, so a client cannot build a body the
 *  server refuses (scripts/check-triage-cap.ts). */
export const MAX_TRIAGE = 200;
/** The operator's sentence for a decision on more than MAX_TRIAGE items, or null when it fits. */
export const triageCapText = (n: number): string | null => (n > MAX_TRIAGE ? `A decision takes at most ${MAX_TRIAGE} items at once (${n} selected)` : null);

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
export const isEmptyScan = (s: ScanSnapshot): boolean => SCAN_TABLES.every((t) => !s[t]?.length);

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
  /** Enabled lenses lens-scan could not measure in the repo as it stands (scan/lens-setup.ts): the scan menu offers a prepare
   *  job for them instead of a scan lens-scan would refuse. [] = every scannable lens is measurable. */
  setup: LensSetupNeed[];
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
