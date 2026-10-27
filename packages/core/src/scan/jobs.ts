// Scan jobs: a lens scan, an execute run or a release run (cut or finish) the blueprint started. Client-safe types and rules; the
// live registry that spawns the Claude Code CLI is jobs.server.ts, the Kettle stand-in is
// lib/model/scan-sim.ts. Absent values are omitted, never null (the store's wire convention).
import type { LensEntry } from '@bp/core/standard/types';
import type { WaveEffort, WaveModel } from './waves.ts';
import { PROPOSAL_ID_PATTERN } from '../standard/schema-vocab.ts';

/** `selection`: exactly the features behind the ledger's selected findings or matrix rows (1..200 slugs). */
export type ScanScopeKind = 'feature' | 'bay' | 'room' | 'wing' | 'all' | 'selection';

/** What a scan is pointed at. `features` are feature slugs; `all` carries none (every feature). */
export interface ScanScope {
  kind: ScanScopeKind;
  /** The place id: a feature slug, capability, domain or wing id. Absent for `all`. */
  id?: string;
  /** What the UI calls it: "Invoice OCR", "Payments room", "Everything". */
  label: string;
  features: string[];
}

/** `prepare`: adjust the product repo so lens-scan can measure a lens it would refuse (scan/lens-setup.ts), e.g. write probes. */
export type JobKind = 'measure' | 'execute' | 'release' | 'prepare';
/** A release job's step: `build` cuts the release (`/lens-scan release --id <rel>`), `finish` tags it after the merge (`--finish`). */
export type ReleaseStep = 'build' | 'finish';
export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface ScanJob {
  id: string;
  kind: JobKind;
  /** The lens a measure job scans, or a prepare job makes measurable. */
  lens?: string;
  scope?: ScanScope;
  /** The proposals an execute job builds. */
  proposals?: string[];
  /** A release job's release id (`rel-<version>`), its version and step. */
  release?: string;
  version?: string;
  step?: ReleaseStep;
  /** An execute job a wave package queued: the model and effort it runs with (absent: the CLI's default), and where it came from. */
  model?: WaveModel;
  effort?: WaveEffort;
  wave?: string;
  package?: string;
  status: JobStatus;
  queued_at: string;
  started_at?: string;
  ended_at?: string;
  /** The store run this job produced, once lens-scan wrote its run-start (run note `bp-job:<id>`). */
  run_id?: string;
  exit_code?: number;
  error?: string;
  /** The last lines of the job's log. */
  log_tail?: string;
}

/** What the UI calls a job when it names it in a line: a release job reads "Release 1.4.1 · build". */
export function jobLabel(j: Pick<ScanJob, 'kind' | 'lens' | 'proposals' | 'version' | 'release' | 'step'>): string {
  if (j.kind === 'release') return 'Release ' + (j.version ?? j.release ?? '') + ' · ' + (j.step ?? 'build');
  if (j.kind === 'prepare') return 'Prepare · ' + (j.lens ?? 'lens');
  if (j.kind === 'execute') return 'Execute · ' + (j.proposals?.length ?? 0) + ' finding' + (j.proposals?.length === 1 ? '' : 's');
  return j.lens ?? 'Scan';
}

/** Lenses lens-scan can measure without a manifest `scan` block (lens-scan v1). */
export const SCAN_BUILTINS: readonly string[] = ['development', 'security', 'design', 'performance'];

/** Whether a lens can be scanned: always in the Kettle sim; live, a built-in method or a `scan` block. */
export function scannable(entry: Pick<LensEntry, 'id' | 'manifest'>, sim: boolean): boolean {
  const m = entry.manifest.scan?.method;
  return sim || SCAN_BUILTINS.includes(entry.id) || m === 'judgement' || m === 'steps';
}

/** A permanent project lens id: reverse DNS, `com.org.name` (lens-manifest-1.schema.json $defs/reverseDns). */
export const PROJECT_LENS_ID = /^[a-z]{2,}(?:\.[a-z0-9-]+){2,}$/;
/** Most features one `selection` scan may name. */
export const MAX_SELECTION = 200;
/** The job registry's limits per product (jobs.server.ts enforces them; the Kettle scan sim mirrors them): at most this
 *  many jobs run at once, at most this many wait queued (the next is refused 429), at most this many proposals per execute job. */
export const MAX_RUNNING = 3, MAX_QUEUED = 16, MAX_PROPOSALS = 50;

/** A glyph+line pair, as checkLensManifest's `taken` lists it (src/lib/scan/manifest-check.ts TakenLook). */
export interface LensLook { glyph: string | { path: string }; line: string }

/** Whether a stored glyph can be compared with another: a name, or a `{ path }`. A hand-edited map can hold neither,
 *  and a look nobody can draw cannot be taken. */
const drawable = (g: unknown): g is string | { path: string } =>
  typeof g === 'string' || (!!g && typeof g === 'object' && typeof (g as { path?: unknown }).path === 'string');

/** The looks of the enabled lenses other than `id`: what a new lens may not repeat. Entries without a presentation,
 *  or whose glyph is neither a name nor a `{ path }`, are skipped. */
export function takenLooks(entries: readonly Pick<LensEntry, 'id' | 'enabled' | 'manifest'>[], id: string): LensLook[] {
  const out: LensLook[] = [];
  for (const e of entries) {
    const p = e.enabled && e.id !== id ? e.manifest?.presentation : undefined;
    if (p && drawable(p.glyph) && typeof p.line === 'string') out.push({ glyph: p.glyph, line: p.line });
  }
  return out;
}

/** A temporary lens id: `tmp.<kebab>`. */
export const TEMP_LENS_ID = /^tmp\.[a-z0-9][a-z0-9-]{1,40}$/;
/** Lens ids, feature slugs and place ids that may reach a spawned command line: scan-wire-1's proposalId.pattern. */
export const SAFE_ID = PROPOSAL_ID_PATTERN;

/** lens-scan writes `bp-job:<id>` into a run's note when started with BP_JOB_ID set. */
export const RUN_NOTE_PREFIX = 'bp-job:';
/** Whether a run's note names job `id`: `bp-job:<id>`, or `bp-job:<id> <more>` (never a bare prefix: j-1 is not j-10). */
export const isJobNote = (note: string | undefined, id: string): boolean => note === RUN_NOTE_PREFIX + id || !!note?.startsWith(RUN_NOTE_PREFIX + id + ' ');

/** A lens execute's answer (POST .../lenses/<id>/execute; the scan sim answers the same): the jobs queued, the ids
 *  approved, and the ones skipped with their status. */
export interface LensExecuteResult { jobs: ScanJob[]; approved: string[]; skipped: { id: string; status: string }[] }
