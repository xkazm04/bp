// The Release tab's state machine as data, and the pure derivations the tab reads: which release is the open one,
// the history, each package item's evidence (verdict, before -> after, flag), the failure step, a job's elapsed time
// and the notes preview. One table (RELEASE_STATE) maps a release status to its step, its words, what a person can do
// and whether its items are locked; the Stepper, the actions row and the Package read it, and nothing else branches
// on a release status. A status alone cannot say whether work is in flight, so `standOf` reads the row WITH its latest
// job (its `stalled` is the row at `building` with nothing running) and `standLine` owns the words for it.
// Value-free of React, so it stays cheap to import from the header strip.
import type { Measurement, Proposal, Release, ReleaseStatus } from '@bp/core/scan/types';
import type { JobStatus, ScanJob } from '@bp/core/scan/jobs';
import type { LensFields } from '@bp/core/scan/compare';
import { conflictsIn, fmtValue, isConflict, noteItem, releaseNotes, type NoteItem } from '@bp/core/train/notes';
import { KEYMAP, type KeyAction } from '../keymap';
import type { TrainData } from '../data';

/** The five steps a release walks, in order; `failed` is shown at the step it failed on. */
export const STEPS: readonly Exclude<ReleaseStatus, 'failed'>[] = ['draft', 'building', 'pr-open', 'merged', 'tagged'];
export const STEP_WORD: Readonly<Record<Exclude<ReleaseStatus, 'failed'>, string>> = {
  draft: 'Package', building: 'Cherry-pick, gates', 'pr-open': 'PR open', merged: 'Merged on GitHub', tagged: 'Tagged, published',
};

/** The reader's word for a release's status, wherever it is read out beside the stepper (STEP_WORD's own promise:
 *  words, not enum values). scripts/check-release-states.ts holds every JSX read of `.status` in this context to it. */
export const STATUS_WORD: Readonly<Record<ReleaseStatus, string>> = {
  draft: 'Draft', building: 'Building', 'pr-open': 'PR open', merged: 'Merged', tagged: 'Tagged', failed: 'Failed',
};

/** What the actions row offers: build a draft, retry a failed one, the PR link, the sample merge (Kettle), finish with
 *  an inline confirm (from pr-open: the store only learns "merged" when Finish runs), finish outright (merged). */
export type RelAction = 'build' | 'retry' | 'pr' | 'sampleMerge' | 'finishAsk' | 'finish';

export interface RelState {
  /** Index into STEPS; -1 for failed (the step comes from the job: failedStep). */
  step: number;
  /** The one line under the actions about where the release stands. */
  hint: (v: string, n: number) => string;
  actions: readonly RelAction[];
  /** Items can no longer leave the release (reopen, rework, descope are refused once it left draft). */
  locked: boolean;
}

export const RELEASE_STATE: Readonly<Record<ReleaseStatus, RelState>> = {
  draft: { step: 0, actions: ['build'], locked: false,
    hint: (v, n) => `A draft of ${n} item${n === 1 ? '' : 's'}: a decision on them can still be undone. Build when the package is right.` },
  building: { step: 1, actions: [], locked: true, hint: () => 'Claude Code is working… the page follows its live stream.' },
  'pr-open': { step: 2, actions: ['pr', 'sampleMerge', 'finishAsk'], locked: true, hint: () => 'Merge the PR on GitHub, then Finish.' },
  merged: { step: 3, actions: ['finish'], locked: true, hint: (v) => `Merged. Finish tags v${v} and publishes the GitHub release.` },
  tagged: { step: 4, actions: [], locked: true, hint: (v) => `Tagged v${v} and published.` },
  failed: { step: -1, actions: ['retry'], locked: true, hint: () => 'Retry the build once the cause is fixed; the package stays as it is.' },
};

/** Each action's button words and the keymap action whose keys it shows (B, F). */
export const ACTION: Readonly<Record<Exclude<RelAction, 'pr'>, { label: (v: string) => string; key?: KeyAction; go?: boolean }>> = {
  build: { label: (v) => `Build release v${v}`, key: 'build', go: true },
  retry: { label: () => 'Retry build', key: 'build', go: true },
  sampleMerge: { label: () => 'Merge (sample)' },
  finishAsk: { label: (v) => `Finish · tag v${v} and publish`, key: 'finish' },
  finish: { label: (v) => `Finish · tag v${v} and publish`, key: 'finish', go: true },
};

/** The keys bound to a keymap action in the release scope (shown as the button's kbd). */
export const keysOf = (a: KeyAction | undefined): string => (a ? KEYMAP.release.find((b) => b.action === a)?.keys[0]?.toUpperCase() ?? '' : '');

/**
 * A store-supplied URL safe to hand to an `href`: http(s) only, else null. The release rows' `pr_url` is written by a
 * Claude Code run in the product repo, so an unchecked scheme there is reachable text - a `javascript:` row would
 * become a link. The rail holds its own store URLs to the same rule through Queue.tsx's `httpUrl`
 * (components/rail/check-keys.ts rule 5, which gates it); the train components' import allow-list
 * (scripts/check-train-quality.mjs) does not reach components/Queue, so the rule is restated here rather than shared.
 */
export const safeUrl = (u: string | undefined): string | null => (u && /^https?:\/\//i.test(u) ? u : null);

/** The release the tab works on: the newest one that is not tagged (a draft, a build, an open PR, a failure). */
export const openRelease = (rels: readonly Release[]): Release | undefined => {
  for (let i = rels.length - 1; i >= 0; i--) if (rels[i].status !== 'tagged') return rels[i];
  return undefined;
};

/** Tagged and failed releases other than the open one, newest first. */
export const historyOf = (rels: readonly Release[], open: Release | undefined): Release[] =>
  rels.filter((r) => r !== open && (r.status === 'tagged' || r.status === 'failed')).reverse();

/** A release's jobs, oldest first. */
export const jobsOf = (jobs: readonly ScanJob[], relId: string | undefined): ScanJob[] =>
  relId === undefined ? [] : jobs.filter((j) => j.kind === 'release' && j.release === relId).sort((a, b) => (a.queued_at < b.queued_at ? -1 : a.queued_at > b.queued_at ? 1 : 0));

export const isActive = (j: ScanJob | undefined): boolean => !!j && (j.status === 'queued' || j.status === 'running');

/** The job log's class for a job's own header line, so its outcome is not told in the same dim grey as its start
 *  (release.css .tr-rel-log: `ok` mint, `err` red, `warn` amber, `idle` dim). A job that failed is read on a terminal
 *  surface where every other failure is red; before this it was `idle` for all five statuses. */
export const JOB_TONE: Readonly<Record<JobStatus, string>> = {
  queued: 'idle', running: 'idle', done: 'ok', failed: 'err', cancelled: 'warn',
};

/** The step a failed release failed at: Finish's step when its last job finished, else building. */
export const failedStep = (last: ScanJob | undefined): number => STEPS.indexOf(last?.step === 'finish' ? 'tagged' : 'building');

/**
 * Where the release stands, from its row AND its latest job: the one place the tab decides whether work is in flight.
 * `stalled` is the state no status alone can name - the row says `building` while nothing is running, because the job
 * failed, was cancelled, ended without moving the row on, or is gone with the in-memory registry that held it.
 * jobs.server.ts leaves the row at `building` in every one of those cases (Kettle's sim writes `failed` instead,
 * train-sim.ts `cancelled()`), and release-job.ts starts a build only from `draft` or `failed`, so the tab says what
 * happened instead of going on claiming a job is working.
 */
export type Stand = 'ok' | 'running' | 'stalled' | 'failed';

export function standOf(rel: Pick<Release, 'status'> | undefined, last: ScanJob | undefined): Stand {
  if (!rel) return 'ok';
  if (isActive(last)) return 'running';
  if (rel.status === 'failed') return 'failed';
  return rel.status === 'building' ? 'stalled' : 'ok';
}

/** The line under the actions: RELEASE_STATE's words, except for a stall, which names what stopped and what is left. */
export function standLine(stand: Stand, rel: Pick<Release, 'status' | 'version'> | undefined, last: ScanJob | undefined, n: number): string {
  if (!rel) return '';
  if (stand !== 'stalled') return RELEASE_STATE[rel.status].hint(rel.version, n);
  const what = !last ? 'No build job is running'
    : last.status === 'cancelled' ? 'The build job was cancelled'
      : last.status === 'failed' ? 'The build job failed'
        : 'The build job ended without moving the release on';
  return `${what} and v${rel.version} is still marked building, so nothing is running. A build starts again from draft or failed.`;
}

/** `12 s`, `3 m 05 s`: a job's run time, to its end or to now. */
export function elapsed(j: ScanJob, now: number): string | undefined {
  if (!j.started_at) return undefined;
  const s = Math.max(0, Math.round(((j.ended_at ? Date.parse(j.ended_at) : now) - Date.parse(j.started_at)) / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} m ${String(s % 60).padStart(2, '0')} s`;
}

// ------------------------------------------------------------------------------------------- package evidence
/** One package item with its evidence: the verdict and the readings it compares, and whether it ships flagged. */
export type PkgItem = NoteItem;

/** Readings by proposal id and phase, one pass over the measurements. */
export function readingsBy(ms: readonly Measurement[]): Map<string, { before: Measurement[]; after: Measurement[] }> {
  const out = new Map<string, { before: Measurement[]; after: Measurement[] }>();
  for (const m of ms) {
    if (!m.proposal_id || !m.phase) continue;
    let e = out.get(m.proposal_id);
    if (!e) out.set(m.proposal_id, (e = { before: [], after: [] }));
    e[m.phase].push(m);
  }
  return out;
}

const NONE = { before: [] as Measurement[], after: [] as Measurement[] };

/** An item's evidence (notes.ts noteItem: the verdict and the flag rule live there). */
export function evidenceOf(p: Proposal, by: ReadonlyMap<string, { before: Measurement[]; after: Measurement[] }>, lenses: readonly LensFields[]): PkgItem {
  const e = by.get(p.id) ?? NONE;
  return noteItem(p, e.before, e.after, lenses);
}

/** Items grouped by lens, first seen first. */
export function byLens<T extends { p: Proposal }>(xs: readonly T[]): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const x of xs) { let a = m.get(x.p.lens); if (!a) m.set(x.p.lens, (a = [])); a.push(x); }
  return [...m];
}

export { isConflict };

/**
 * The notes the release run will write, as a preview from the package: notes.ts releaseNotes in mode "preview", the
 * one writer Kettle's sample run also calls, so the stored notes repeat these lines (scripts/check-release-notes.ts).
 */
export const notesPreview = (product: string, version: string, items: readonly PkgItem[], conflicts: readonly Proposal[]): string =>
  releaseNotes({ product, version, mode: 'preview', items, conflicts });

/** `before → after unit` for a package line ("unmeasured" when a side is missing). */
export function moveText(x: Pick<PkgItem, 'from' | 'to'>): string {
  if (!x.from || !x.to) return 'unmeasured';
  return `${fmtValue(x.from.value)} → ${fmtValue(x.to.value)}${x.from.unit ? ' ' + x.from.unit : ''}`;
}

// ------------------------------------------------------------------------------------------- the tab's model
/** Everything the tab shows, derived once per stream change (ReleaseView's useReleaseModel). */
export interface ReleaseModel {
  T: TrainData;
  /** The open release (not tagged), if any. */
  rel?: Release;
  /** Its jobs, oldest first, and the latest. */
  jobs: ScanJob[];
  last?: ScanJob;
  /** The package: the release's items, or (no release yet) the accepted items with no release. */
  items: PkgItem[];
  /** Accepted items with no release (what a new draft takes). */
  free: number;
  history: Release[];
}

/** Rework items a release's cherry-pick conflict sent back (all of them with no open release). */
export const conflictsOf = (m: Pick<ReleaseModel, 'T' | 'rel'>): Proposal[] =>
  conflictsIn(m.T.proposals, m.rel?.branch);
