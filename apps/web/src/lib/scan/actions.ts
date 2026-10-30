// The one way the UI starts, dispatches and cancels scan work. A live product goes to its localhost
// routes (the server spawns the Claude Code CLI); the Kettle sample goes to the scan sim. Callers never
// branch on which.
import type { ReleaseReady, ScanSim } from '@bp/core/model/scan-sim';
import { takenLooks, type ScanJob, type ScanScope } from '@bp/core/scan/jobs';
import type { LensEntry, LensManifest } from '@bp/core/standard/types';
import { deleteJob, deleteWaveReq, executeLens, getCommitDiff, getReleaseSuggestion, getWaves, patchWaveReq, postAllLenses, postDispatch, postPrepare, postProjectLens, postRelease, postReleaseBuild, postReleaseBuildDry, postReleaseFinish, postScan, postTriage, postVeto, postWave, postWaveDispatch, type LensExecuteResult } from './client.ts';
import type { CommitDiff, Proposal, ReleaseCreated, TriageBody, TriageDecision, TriageResult, VersionSuggestion } from '@bp/core/scan/types';
import type { Wave, WaveBody, WaveDispatchResult } from '@bp/core/scan/waves';
import { checkLensManifest } from '@bp/core/scan/manifest-check';
import { addTempLens, readTempLenses } from './temp-lens.ts';

export interface ScanCtx {
  /** The live product's slug; null for the Kettle sample. */
  slug: string | null;
  /** The Kettle scan sim; null for a live product. */
  sim: ScanSim | null;
}

export interface DispatchResult { job: ScanJob; approved: string[]; skipped: { id: string; status: string }[] }

const nowhere = () => Object.assign(new Error('Nothing to scan with: no live product and no sample sim'), { status: 503 });
const refused = (status: number, error: string) => Object.assign(new Error(error), { status, body: { error } });

/** Start a measure scan of one lens over a scope. Rejects with an Error carrying `status` on a refusal. */
export async function startScan(ctx: ScanCtx, lens: string, scope: ScanScope): Promise<ScanJob> {
  if (ctx.slug) return postScan(ctx.slug, lens, scope);
  if (ctx.sim) return ctx.sim.startScan(lens, scope);
  throw nowhere();
}

/** ONE measure or propose job over every enabled lens (`--lens all`, one MAX_RUNNING slot). A live product only: the Kettle
 *  sim has no every-lens job, and the ledger offers it on a live product only. */
export async function startAllLenses(ctx: ScanCtx, phase: 'measure' | 'propose'): Promise<ScanJob> {
  if (ctx.slug) return postAllLenses(ctx.slug, phase);
  throw Object.assign(new Error('every-lens jobs run on a live product (the sample scans one lens at a time)'), { status: 400 });
}

/** A person's veto of a machine decision inside its window: the row goes back to proposed (live products only). */
export async function vetoDecision(ctx: ScanCtx, id: string, reason: string): Promise<Proposal> {
  if (ctx.slug) return postVeto(ctx.slug, id, reason);
  throw Object.assign(new Error('the sample has no machine decisions to veto'), { status: 400 });
}

/** Approve the proposed ones among `ids` and start one execute run over all of them. */
export async function dispatch(ctx: ScanCtx, ids: string[]): Promise<DispatchResult> {
  if (ctx.slug) return postDispatch(ctx.slug, ids);
  if (ctx.sim) return ctx.sim.dispatch(ids);
  throw nowhere();
}

/** Measure one lens over exactly `features` (the ledger's selection, 1..MAX_SELECTION slugs): a `selection` scope
 *  labelled "Selection (n)". More than MAX_SELECTION, none, or one the map lacks: 400 bad-scope. */
export async function startSelectionScan(ctx: ScanCtx, lens: string, features: string[]): Promise<ScanJob> {
  return startScan(ctx, lens, { kind: 'selection', label: 'Selection (' + features.length + ')', features });
}

/** Execute a lens's backlog: approve its proposed findings, build them with its approved ones, in jobs of at most 50.
 *  Rejects 400 unknown-lens, 409 'nothing to execute' (body.skipped), 429 when the queue cap stopped it (body.jobs:
 *  the ones queued; the approvals stand). */
export async function executeLensBacklog(ctx: ScanCtx, lens: string): Promise<LensExecuteResult> {
  if (ctx.slug) return executeLens(ctx.slug, lens);
  if (ctx.sim) return ctx.sim.executeLens(lens);
  throw nowhere();
}

/** Adjust the product repo so lens-scan can measure `lens` (a prepare job, jobs.server.ts preparePrompt); Kettle's sim ends it done. */
export async function prepareLens(ctx: ScanCtx, lens: string): Promise<ScanJob> {
  if (ctx.slug) return postPrepare(ctx.slug, lens);
  if (ctx.sim) return ctx.sim.prepareLens(lens);
  throw nowhere();
}

/** Add a lens to the product: a permanent project lens (reverse-DNS id) or, with `temporary` (or a tmp.* id), a
 *  temporary one. Kettle keeps it in this browser (temp-lens.ts) under the same checks as the route: 400 with why
 *  (checkLensManifest in the matching mode, the model's other enabled looks taken), 409 when the id exists. */
export async function addProjectLens(ctx: ScanCtx, manifest: LensManifest, temporary = false): Promise<LensEntry> {
  if (ctx.slug) return postProjectLens(ctx.slug, manifest, temporary);
  if (!ctx.sim) throw nowhere();
  const id = (manifest as { id?: unknown } | null)?.id;
  const temp = temporary || (typeof id === 'string' && id.startsWith('tmp.'));
  const stored = readTempLenses(), known = ctx.sim.lensEntries();
  const all = [...known, ...stored.filter((e) => !known.some((k) => k.id === e.id))];
  const bad = checkLensManifest(manifest, { mode: temp ? 'temporary' : 'project', taken: takenLooks(all, String(id)) });
  if (bad) throw refused(400, bad);
  if (ctx.sim.hasLens(manifest.id) || all.some((e) => e.id === manifest.id)) throw refused(409, `A lens with id ${manifest.id} exists`);
  const base = { id: manifest.id, version: manifest.version, source: 'project' as const, enabled: true, created_at: new Date().toISOString(), manifest };
  const entry: LensEntry = temp ? { ...base, temporary: true } : base;
  addTempLens(entry);
  return entry;
}

// ------------------------------------------------------------------------------------------- the release train
// The ledger's triage and release actions: a live product goes to its routes (store.mjs and the Claude Code CLI with
// the user's gh login); Kettle goes to the scan sim's sample train. Same results, same refusals (Error + status + body).

/** Triage built items: accept, rework, descope, or reopen (the undo). Rejects 409 when none moved (`body` = the result). */
export async function triageItems(ctx: ScanCtx, ids: string[], decision: TriageDecision, note?: string): Promise<TriageResult> {
  const body: TriageBody = note === undefined ? { ids, decision } : { ids, decision, note };
  if (ctx.slug) return postTriage(ctx.slug, body);
  if (ctx.sim) return ctx.sim.triage(body);
  throw nowhere();
}
/** The suggested next version, with what it came from and why. */
export async function suggestRelease(ctx: ScanCtx): Promise<VersionSuggestion> {
  if (ctx.slug) return getReleaseSuggestion(ctx.slug);
  if (ctx.sim) return ctx.sim.suggestRelease();
  throw nowhere();
}
/** A draft release of accepted items (default: every accepted item with no release). */
export async function createRelease(ctx: ScanCtx, version: string, ids?: string[]): Promise<ReleaseCreated> {
  if (ctx.slug) return postRelease(ctx.slug, version, ids);
  if (ctx.sim) return ctx.sim.createRelease(version, ids);
  throw nowhere();
}
/** Start the job that builds a release (cherry-picks, gates, notes, PR). Rejects 412 'gh not authenticated'. */
export async function buildRelease(ctx: ScanCtx, id: string): Promise<ScanJob> {
  if (ctx.slug) return postReleaseBuild(ctx.slug, id);
  if (ctx.sim) return ctx.sim.buildRelease(id);
  throw nowhere();
}
export type { ReleaseReady };
/** The build's pre-flight: every refusal the build would give, with nothing started (live: the route's dry run, which
 *  never spawns gh; Kettle: the sim's, which reads its gh toggle). Rejects as buildRelease does. */
export async function preflightRelease(ctx: ScanCtx, id: string): Promise<ReleaseReady> {
  if (ctx.slug) return postReleaseBuildDry(ctx.slug, id);
  if (ctx.sim) return ctx.sim.preflightRelease(id);
  throw nowhere();
}
/** Start the job that finishes a release after its PR merged (tag, GitHub release). Rejects 412 as build. */
export async function finishRelease(ctx: ScanCtx, id: string): Promise<ScanJob> {
  if (ctx.slug) return postReleaseFinish(ctx.slug, id);
  if (ctx.sim) return ctx.sim.finishRelease(id);
  throw nowhere();
}
/** One item commit's stat and patch. */
export async function commitDiff(ctx: ScanCtx, sha: string): Promise<CommitDiff> {
  if (ctx.slug) return getCommitDiff(ctx.slug, sha);
  if (ctx.sim) return ctx.sim.commitDiff(sha);
  throw nowhere();
}

export async function cancelJob(ctx: ScanCtx, id: string): Promise<ScanJob> {
  if (ctx.slug) return deleteJob(ctx.slug, id);
  if (ctx.sim) return ctx.sim.cancel(id);
  throw nowhere();
}

/** A refusal in words for a toast, and the words of a failed request's cause: refusal.ts owns both, so the
 *  project list's alert (projects.ts) says the same things about the same shapes. */
export { causeWords, refusalText } from './refusal.ts';

// ------------------------------------------------------------------------------------------- waves
// Findings grouped into packages (each with a model and an effort) and dispatched as a whole (waves.ts). A live product
// goes to its /waves routes (waves.server.ts); Kettle keeps its waves in this browser (scan-sim). Same results, same
// refusals (Error + status + body): 400 bad body, 409 taken (a finding in another draft wave) / not a draft / none could go,
// 429 queue full (body.wave + body.jobs: what was queued before it).
export async function listWaves(ctx: ScanCtx): Promise<Wave[]> {
  if (ctx.slug) return getWaves(ctx.slug);
  if (ctx.sim) return ctx.sim.listWaves();
  throw nowhere();
}
export async function createWave(ctx: ScanCtx, body: WaveBody): Promise<Wave> {
  if (ctx.slug) return postWave(ctx.slug, body);
  if (ctx.sim) return ctx.sim.createWave(body);
  throw nowhere();
}
/** A draft wave's name and/or packages (the packages replace the old ones). */
export async function updateWave(ctx: ScanCtx, id: string, patch: Partial<WaveBody>): Promise<Wave> {
  if (ctx.slug) return patchWaveReq(ctx.slug, id, patch);
  if (ctx.sim) return ctx.sim.updateWave(id, patch);
  throw nowhere();
}
export async function deleteWave(ctx: ScanCtx, id: string): Promise<{ id: string }> {
  if (ctx.slug) return deleteWaveReq(ctx.slug, id);
  if (ctx.sim) return ctx.sim.deleteWave(id);
  throw nowhere();
}
/** Dispatch the wave (default: every package) or only the named packages: one execute job per package and 50 findings. */
export async function dispatchWave(ctx: ScanCtx, id: string, packages?: string[]): Promise<WaveDispatchResult> {
  if (ctx.slug) return postWaveDispatch(ctx.slug, id, packages);
  if (ctx.sim) return ctx.sim.dispatchWave(id, packages);
  throw nowhere();
}
