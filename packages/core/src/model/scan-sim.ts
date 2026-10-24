// The Kettle sample's stand-in for the Claude Code CLI: scans and execute runs that play out in the
// browser and emit the same store rows a real lens-scan run writes, so the model applies them on the
// live path (applyScan) and every scan view is shared with live products.
// A timer runs only while a job runs (never a rAF); every change notifies once per tick. Pure and free of
// '@/' value imports, so Node can drive it (the scan-package probes). It also keeps the sample's ledger waves (waves.ts)
// in this browser (localStorage `bp.waves.kettle`, memory when storage refuses), under the rules waves.server.ts applies. The sample release train (packs, triage, releases,
// the release job's steps) is train-sim.ts, seeded at the first bind; its jobs run on this timer.
import type { Activity, ActivityKind, CommitDiff, Measurement, Proposal, ReleaseCreated, Run, ScanSnapshot, TriageBody, TriageResult, VersionSuggestion } from '@bp/core/scan/types';
import type { ReleaseStep, ScanJob, ScanScope } from '@bp/core/scan/jobs';
import type { LensExecuteResult } from '@bp/core/scan/jobs';
import type { LensEntry, LensField, LensManifest } from '@bp/core/standard/types';
import { MAX_PROPOSALS, MAX_QUEUED, MAX_RUNNING, MAX_SELECTION, RUN_NOTE_PREFIX, SAFE_ID, TEMP_LENS_ID } from '../scan/jobs.ts';
import { NOTHING_TO_BUILD, admitForBuild, buildChunks, busyIds } from '../scan/admit.ts';
import { WAVE_EFFORTS, WAVE_MODELS, createIn, packagesOf, patchIn, recordJobs, removeIn, type Wave, type WaveBody, type WaveDispatchResult, type WaveEffort, type WaveModel } from '../scan/waves.ts';
import { TrainSim, type TrainToggles } from './train-sim.ts';
import { NUMERIC } from '../standard/present.ts';
import { SCAN_SCOPE_KINDS } from '../standard/schema-vocab.ts';

export type { TrainToggles };

/** A build's pre-flight answer (POST build `{"dry":true}`, ScanSim.preflightRelease): every guard passed and nothing was
 *  queued. `gh` is `unchecked` on a live product: a dry run reads local state only and never spawns gh, so the login is
 *  still checked when the build starts; the sample's toggle is local state, so it says `signed-in`. */
export interface ReleaseReady { ready: true; gh: 'signed-in' | 'unchecked' }

/** What the sim needs of the product: bound once the model is built (`ScanSim.bind`). */
export interface ScanSimProduct {
  /** Base feature slugs in layout order (left to right): what `all` walks, and the order a scope is walked in. */
  order: readonly string[];
  /** An enabled lens's manifest, else undefined (unknown or disabled lenses cannot be scanned). */
  manifest(lens: string): LensManifest | undefined;
  /** The value a feature's facet holds now for a lens field (a reading laid over it included), else undefined. */
  value(feature: string, lens: string, key: string): number | undefined;
  /** Every lens entry of the model, enabled or not: the ids and looks a new Kettle lens may not repeat. Absent = the
   *  enabled ones `manifest` answers for are all that is known. */
  lenses?(): readonly LensEntry[];
}

/** One feature per STEP_MS; an execute job takes about EXEC_MS over all its proposals. */
const STEP_MS = 1200, EXEC_MS = 15000, TICK_MS = 200, MAX_IDS = MAX_PROPOSALS; // the registry's limits (jobs.ts)
/** One release-job step (cut, a cherry-pick per item, gates, notes, PR): a build of 2-6 items takes about 6-10 s. */
const RELEASE_STEP_MS = 1000, LOG_LINES = 20;
/** Share of features a temporary lens finds nothing to say about (deterministic per feature and lens). */
const NO_IMPACT = 0.4;
const KINDS = new Set<string>(SCAN_SCOPE_KINDS);
export const WAVES_KEY = 'bp.waves.kettle';
/** What a wave package runs its execute job with (jobs.server.ts ExecuteOpts). */
interface ExecOpts { model?: WaveModel; effort?: WaveEffort; wave?: string; package?: string }

/** FNV-1a then one mulberry32 step: a stable 0..1 per string (the fixture scripts' PRNG idea, inline). */
function rand01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  let t = (h + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), 1 | t); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const hex7 = (s: string) => Math.floor(rand01(s) * 0xfffffff).toString(16).padStart(7, '0');
const refuse = (status: number, error: string, extra?: Record<string, unknown>): Error => Object.assign(new Error(error), { status, body: { error, ...extra } });

interface Rec {
  job: ScanJob;
  /** Measure: the features to walk; execute: the proposal ids to build. */
  items: string[];
  i: number;
  /** When the current item finishes (ms, opts.now clock). */
  stepAt: number;
  step: number;
  runId: string;
}

export class ScanSim {
  private now: () => number;
  private prod: ScanSimProduct | null = null;
  private recs: Rec[] = [];
  private runs: Run[] = [];
  private ms: Measurement[] = [];
  private act: Activity[] = [];
  private props: Proposal[];
  private pAt = new Map<string, number>();
  private na = new Map<string, Set<string>>();
  private nextId = 0; private mId = 0; private aId = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private subs = new Set<() => void>();
  private queued = false;
  private v = 0;
  private snapV = -1; private snap: ScanSnapshot | null = null;
  private jobsV = -1; private jobList: readonly ScanJob[] = [];
  private dead = false;
  private train: TrainSim;
  private seeded = false;

  constructor(opts: { now: () => number; findings: readonly Proposal[] }) {
    this.now = opts.now;
    this.props = opts.findings.slice();
    this.props.forEach((p, i) => this.pAt.set(p.id, i));
    this.train = new TrainSim({
      now: () => this.now(), runs: this.runs, ms: this.ms, act: this.act, props: this.props, pAt: this.pAt,
      nextMeasurement: () => ++this.mId, nextActivity: () => ++this.aId, changed: () => this.changed(),
      field: (lens, key) => (this.prod?.manifest(lens) ?? this.lensEntries().find((e) => e.id === lens)?.manifest)?.fields.find((f) => f.key === key),
    });
  }

  /** Give the sim the product it scans (the model, once built). Scans refuse until then. The first bind seeds the
   *  sample release train over its features; a rebind (the model rebuilt in place) keeps it. */
  bind(p: ScanSimProduct): void {
    this.prod = p;
    if (!this.seeded) { this.seeded = true; this.train.seed(p.order, (f, l, k) => p.value(f, l, k)); this.changed(); }
  }
  /** Bumped on every change. */
  get version(): number { return this.v; }

  /** Every job so far, oldest first. The same array until a job changes. */
  jobs(): readonly ScanJob[] {
    if (this.jobsV !== this.v) { this.jobsV = this.v; const next = this.recs.map((r) => r.job); if (next.length !== this.jobList.length || next.some((j, i) => j !== this.jobList[i])) this.jobList = next; }
    return this.jobList;
  }
  /** The synthetic store so far: runs, measurements, activity and the findings' current states. New tables per change (the readings are applied by table identity). */
  snapshot(): ScanSnapshot {
    if (!this.snap || this.snapV !== this.v) {
      this.snapV = this.v;
      this.snap = { runs: this.runs.slice(), measurements: this.ms.slice(), proposals: this.props.slice(), activity: this.act.slice(), shots: this.train.shots.slice(), coverage: [], packs: this.train.packs.slice(), releases: this.train.releases.slice() };
    }
    return this.snap;
  }
  /** The features a temporary lens found nothing to say about, by lens: their health must read `na`. */
  noImpact(): ReadonlyMap<string, ReadonlySet<string>> { return this.na; }

  startScan(lens: string, scope: ScanScope): ScanJob {
    const P = this.prod;
    if (!P) throw refuse(503, 'The sample is still loading');
    if (!P.manifest(lens)) throw refuse(400, 'unknown-lens');
    const all = scope?.kind === 'all', known = new Set(P.order);
    if (!scope || !KINDS.has(scope.kind) || typeof scope.label !== 'string' || !scope.label || !Array.isArray(scope.features)
      || (all ? scope.features.length > 0 || scope.id !== undefined : !scope.features.length || scope.features.some((f) => !known.has(f)))
      || (scope.kind === 'selection' && (scope.id !== undefined || scope.features.length > MAX_SELECTION))) throw refuse(400, 'bad-scope');
    if (this.recs.filter((r) => r.job.status === 'queued').length >= MAX_QUEUED) throw refuse(429, 'queue-full');
    const at = this.iso();
    const id = 'sim-' + ++this.nextId;
    const rank = new Map(P.order.map((s, i) => [s, i]));
    const items = all ? P.order.slice() : [...new Set(scope.features)].sort((a, b) => rank.get(a)! - rank.get(b)!);
    const job: ScanJob = { id, kind: 'measure', lens, scope: { ...scope, features: scope.features.slice() }, status: 'queued', queued_at: at };
    this.recs.push({ job, items, i: 0, stepAt: 0, step: STEP_MS, runId: 'run-' + id });
    this.pump();
    this.changed();
    return this.recOf(id)!.job;
  }

  dispatch(ids: string[], opts: ExecOpts = {}): { job: ScanJob; approved: string[]; skipped: { id: string; status: string }[] } {
    if (!Array.isArray(ids) || !ids.length || ids.length > MAX_IDS || ids.some((x) => typeof x !== 'string')) throw refuse(400, 'bad-ids');
    if ((opts.model !== undefined && !WAVE_MODELS.includes(opts.model)) || (opts.effort !== undefined && !WAVE_EFFORTS.includes(opts.effort))
      || (opts.wave !== undefined && !SAFE_ID.test(opts.wave)) || (opts.package !== undefined && !SAFE_ID.test(opts.package))) throw refuse(400, 'bad-opts');
    const at = this.iso(), { approved, go, skipped } = this.admit(ids, at);
    if (!go.length) throw refuse(409, NOTHING_TO_BUILD, { skipped });
    const id = this.queueExecute(go, at, opts);
    this.pump();
    this.changed();
    return { job: this.recOf(id)!.job, approved, skipped };
  }

  /**
   * Execute a lens's backlog, as POST /lenses/<id>/execute does: approve its proposed findings, take its approved
   * ones (store order), skip the rest with their status (`in-job` for one a queued or running job builds), and queue
   * execute jobs of at most 50. 400 unknown-lens, 409 nothing to execute, 429 queue-full (the approvals stand).
   */
  executeLens(lens: string): LensExecuteResult {
    const P = this.prod;
    if (!P) throw refuse(503, 'The sample is still loading');
    if (!P.manifest(lens)) throw refuse(400, 'unknown-lens');
    const at = this.iso();
    const mine = this.props.filter((x) => x.lens === lens).sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1));
    const { approved, go, skipped } = this.admit(mine.map((p) => p.id), at);
    if (!go.length) throw refuse(409, 'nothing to execute', { skipped });
    const jobs: ScanJob[] = [];
    let full = false;
    for (const chunk of buildChunks(go)) {
      if (this.recs.filter((r) => r.job.status === 'queued').length >= MAX_QUEUED) { full = true; break; }
      jobs.push(this.recOf(this.queueExecute(chunk, at))!.job);
      this.pump();
    }
    this.changed();
    if (full) throw refuse(429, 'queue-full', { jobs: jobs.map((j) => this.recOf(j.id)!.job), approved, skipped });
    return { jobs: jobs.map((j) => this.recOf(j.id)!.job), approved, skipped };
  }

  // ----------------------------------------------------------------------------------------- the sample waves
  // Ledger waves (waves.ts) kept in this browser, under the rules and refusals of waves.server.ts: 400 bad body, 404, 409 taken /
  // not a draft / none could go, 429 queue-full (its body carries the wave and the jobs queued before the cap).
  private wavesMem: Wave[] | null = null;
  private wavesLoaded = false;
  private readWaves(): Wave[] {
    let raw: string | null = null;
    try { raw = globalThis.localStorage?.getItem(WAVES_KEY) ?? null; } catch { /* storage refuses: memory holds them */ }
    let out = this.wavesMem ?? [];
    if (raw !== null) {
      try {
        const j = JSON.parse(raw) as unknown;
        if (Array.isArray(j)) out = j.filter((w): w is Wave => !!w && typeof w.id === 'string' && typeof w.name === 'string' && Array.isArray(w.packages) && (w.status === 'draft' || w.status === 'dispatched'));
      } catch { /* a broken value reads as none */ }
    }
    if (!this.wavesLoaded) {
      // a wave dispatched in an earlier visit points at jobs this sim no longer has (the sample starts afresh): it is a draft again
      this.wavesLoaded = true;
      out = out.map((w) => { if (w.status !== 'dispatched') return w; const { jobs: _jobs, dispatched_at: _at, ...rest } = w; return { ...rest, status: 'draft' as const }; });
      this.writeWaves(out);
    }
    this.wavesMem = out;
    return out;
  }
  private writeWaves(waves: Wave[]): void {
    this.wavesMem = waves;
    try { globalThis.localStorage?.setItem(WAVES_KEY, JSON.stringify(waves)); } catch { /* memory still holds them */ }
  }
  listWaves(): Wave[] { return this.readWaves(); }
  createWave(body: WaveBody): Wave {
    const r = createIn(this.readWaves(), body, this.iso());
    if (!r.ok) throw refuse(r.status, r.error, r.taken ? { taken: r.taken } : undefined);
    this.writeWaves(r.waves);
    return r.wave;
  }
  updateWave(id: string, patch: Partial<WaveBody>): Wave {
    const r = patchIn(this.readWaves(), id, patch);
    if (!r.ok) throw refuse(r.status, r.error, r.taken ? { taken: r.taken } : undefined);
    this.writeWaves(r.waves);
    return r.wave;
  }
  deleteWave(id: string): { id: string } {
    const r = removeIn(this.readWaves(), id);
    if (!r.ok) throw refuse(r.status, r.error);
    this.writeWaves(r.waves);
    return { id };
  }
  /** Dispatch a wave (default: every package) or the named packages, as POST waves/[wave]/dispatch. */
  dispatchWave(id: string, names?: string[]): WaveDispatchResult {
    if (!this.prod) throw refuse(503, 'The sample is still loading');
    const waves = this.readWaves(), wave = waves.find((w) => w.id === id);
    if (!wave) throw refuse(404, `no wave ${id}`);
    const pkgs = packagesOf(wave, names);
    if (typeof pkgs === 'string') throw refuse(400, pkgs);
    const approved: string[] = [], skipped: { id: string; status: string }[] = [], refs: { package: string; job: string }[] = [], at = this.iso();
    let full = false, went = 0;
    for (const pk of pkgs) {
      if (full) break;
      const t = this.admit(pk.ids, at); // the jobs queued for an earlier package are in this.recs: they hold their findings
      approved.push(...t.approved); skipped.push(...t.skipped); went += t.go.length;
      for (const chunk of buildChunks(t.go)) {
        if (this.recs.filter((r) => r.job.status === 'queued').length >= MAX_QUEUED) { full = true; break; }
        refs.push({ package: pk.id, job: this.queueExecute(chunk, at, { model: pk.model, effort: pk.effort, wave: wave.id, package: pk.id }) });
        this.pump();
      }
    }
    if (!refs.length && !full && !went) { this.changed(); throw refuse(409, 'none of these findings can be built (only proposed or approved ones that no job is building can)', { skipped }); }
    const next = recordJobs(wave, refs, at);
    if (refs.length) this.writeWaves(waves.map((w) => (w.id === id ? next : w)));
    this.changed();
    const jobs = refs.map((r) => this.recOf(r.job)!.job);
    if (full) throw refuse(429, 'queue-full', { wave: next, jobs, approved, skipped });
    return { wave: next, jobs, approved, skipped };
  }

  // ----------------------------------------------------------------------------------------- the sample train
  // Kettle's release train (train-sim.ts): sample packs over Kettle features, triage and reopen, a version
  // suggestion, and a release job draft -> building -> pr-open -> (sampleMerge) -> merged -> tagged on the sim timer.
  // Same results and refusals as the routes (Error + status + body). Everything it makes is labelled sample.

  /** Triage built items, as POST triage: 409 with the result as `body` when none moved. */
  triage(body: TriageBody): TriageResult { return this.train.triage(body); }
  /** The next version for the accepted items with no release, as GET releases/suggest. */
  suggestRelease(): VersionSuggestion { return this.train.suggest(); }
  /** A draft release, as POST releases. */
  createRelease(version: string, ids?: string[]): ReleaseCreated { return this.train.create(version, ids); }
  /** The sample job that builds a release (draft or failed); 412 'gh not authenticated' when the gh toggle is off. */
  buildRelease(id: string): ScanJob { return this.queueRelease(id, 'build'); }
  /** The sample job that finishes a merged release (tag, items released, settled packs closed). */
  finishRelease(id: string): ScanJob { return this.queueRelease(id, 'finish'); }
  /** The build's pre-flight, as POST build `{"dry":true}`: every refusal the build would give (400, 404, 409, 412 when
   *  the gh toggle is off, 429), then `{ ready: true }` with no job queued and nothing notified. */
  preflightRelease(id: string): ReleaseReady { this.queueRelease(id, 'build', true); return { ready: true, gh: 'signed-in' }; }
  /** Kettle only: stands in for the person merging the PR on GitHub (pr-open -> merged). */
  sampleMerge(id: string): void { this.train.merge(id); }
  /** A sample item commit's diff. */
  commitDiff(sha: string): CommitDiff { return this.train.diff(sha); }
  /** Kettle only: what the sample release job should run into (all off = a clean run, gh logged in). */
  get trainToggles(): TrainToggles { return this.toggles; }
  setTrainToggles(t: TrainToggles): void { this.toggles = t; this.changed(); }
  private toggles: TrainToggles = { ghOff: false, conflict: false, gateFails: false };

  /** Every lens entry the bound model knows (enabled or not); [] before bind or when the model gave none. */
  lensEntries(): readonly LensEntry[] { return this.prod?.lenses?.() ?? []; }
  /** Whether the model has a lens with this id, enabled or not (as far as it was told). */
  hasLens(id: string): boolean { return !!this.prod?.manifest(id) || this.lensEntries().some((e) => e.id === id); }

  cancel(id: string): ScanJob {
    const r = this.recOf(id);
    if (!r) throw refuse(404, 'unknown-job');
    const st = r.job.status;
    if (st !== 'queued' && st !== 'running') return r.job;
    const at = this.iso();
    if (st === 'running') {
      this.setRun(r.runId, { status: 'aborted', ended_at: at, updated_at: at });
      // the proposal being built goes back to approved: nothing was committed
      if (r.job.kind === 'execute') { const p = this.prop(r.items[r.i]); if (p?.status === 'executing') this.setProp(p.id, { status: 'approved', updated_at: at }); }
      if (r.job.kind === 'release') this.train.cancelled(r.job);
    }
    this.setJob(r, { status: 'cancelled', ended_at: at });
    this.pump();
    this.changed();
    return r.job;
  }

  /** Called on change (a job moved, rows were added), at most once per tick. Returns the unsubscribe. Bound: pass it around as is. */
  subscribe = (fn: () => void): (() => void) => { this.subs.add(fn); return () => { this.subs.delete(fn); }; };

  dispose(): void { this.dead = true; this.stop(); this.subs.clear(); }

  // ------------------------------------------------------------------------------------------ engine
  private iso(t = this.now()): string { return new Date(t).toISOString(); }
  private recOf(id: string): Rec | undefined { return this.recs.find((r) => r.job.id === id); }
  /** Add a queued execute job over `ids`; answers its id (the caller pumps and notifies). */
  /** packages/core/src/scan/admit.ts's rule over the sim's findings and jobs: the proposed ones approved here (decided_by 'blueprint'). */
  private admit(ids: Iterable<string>, at: string): { approved: string[]; go: string[]; skipped: { id: string; status: string }[] } {
    const a = admitForBuild(ids, (id) => this.prop(id)?.status, busyIds(this.recs.map((r) => r.job)));
    for (const id of a.approve) this.setProp(id, { status: 'approved', decided_by: 'blueprint', decided_at: at, updated_at: at });
    return { approved: a.approve, go: a.take, skipped: a.skipped };
  }
  private queueExecute(ids: string[], at: string, opts: ExecOpts = {}): string {
    const id = 'sim-' + ++this.nextId, { model, effort, wave, package: pkg } = opts;
    const job: ScanJob = { id, kind: 'execute', proposals: ids, ...(model ? { model } : {}), ...(effort ? { effort } : {}), ...(wave ? { wave } : {}), ...(pkg ? { package: pkg } : {}), status: 'queued', queued_at: at };
    this.recs.push({ job, items: ids, i: 0, stepAt: 0, step: Math.max(1500, EXEC_MS / ids.length), runId: 'run-' + id });
    return id;
  }
  /** Queue a release job as the build and finish routes do: 400/404/409 from the release's state, 409 when one runs, 412, 429. */
  private queueRelease(id: string, step: ReleaseStep, dry: true): null;
  private queueRelease(id: string, step: ReleaseStep): ScanJob;
  private queueRelease(id: string, step: ReleaseStep, dry = false): ScanJob | null {
    const rel = this.train.startable(id, step);
    if (this.recs.some((r) => r.job.kind === 'release' && r.job.release === id && (r.job.status === 'queued' || r.job.status === 'running'))) throw refuse(409, `a release job for ${id} is already queued or running`);
    if (this.toggles.ghOff) throw refuse(412, 'gh not authenticated');
    if (this.recs.filter((r) => r.job.status === 'queued').length >= MAX_QUEUED) throw refuse(429, 'queue-full');
    if (dry) return null;
    const jid = 'sim-' + ++this.nextId;
    this.recs.push({ job: { id: jid, kind: 'release', release: id, version: rel.version, step, status: 'queued', queued_at: this.iso() }, items: [], i: 0, stepAt: 0, step: RELEASE_STEP_MS, runId: 'run-' + jid });
    this.pump();
    this.changed();
    return this.recOf(jid)!.job;
  }
  private prop(id: string | undefined): Proposal | undefined { const i = id === undefined ? undefined : this.pAt.get(id); return i === undefined ? undefined : this.props[i]; }
  private setProp(id: string, patch: Partial<Proposal>) { const i = this.pAt.get(id); if (i !== undefined) this.props[i] = { ...this.props[i], ...patch }; }
  private setJob(r: Rec, patch: Partial<ScanJob>) { r.job = { ...r.job, ...patch }; }
  private setRun(id: string, patch: Partial<Run>) { const i = this.runs.findIndex((x) => x.id === id); if (i >= 0) this.runs[i] = { ...this.runs[i], ...patch }; }
  private log(run: string, kind: ActivityKind, text: string, feature?: string, lens?: string) {
    this.act.push({ id: ++this.aId, run_id: run, at: this.iso(), kind, text, ...(feature ? { feature } : {}), ...(lens ? { lens } : {}) });
  }
  /** Notify once for everything that changed in this turn. */
  private changed() {
    this.v++;
    if (this.queued || this.dead) return;
    this.queued = true;
    queueMicrotask(() => { this.queued = false; if (!this.dead) for (const fn of [...this.subs]) fn(); });
  }
  private stop() { if (this.timer !== null) { clearInterval(this.timer); this.timer = null; } }

  /** Start queued jobs, oldest first, while fewer than MAX_RUNNING run; the timer runs exactly while one does. */
  private pump() {
    let running = this.recs.filter((r) => r.job.status === 'running').length;
    for (const r of this.recs) {
      if (running >= MAX_RUNNING) break;
      if (r.job.status !== 'queued') continue;
      this.begin(r); running++;
    }
    if (running && this.timer === null && !this.dead) this.timer = setInterval(() => this.tick(), TICK_MS);
    if (!running) this.stop();
  }

  private begin(r: Rec) {
    const t = this.now(), at = this.iso(t), j = r.job;
    if (j.kind === 'release') {
      r.items = this.train.begin(j, r.runId, this.toggles);
      this.setJob(r, { status: 'running', started_at: at, ...(j.step !== 'finish' && r.items.length ? { run_id: r.runId } : {}) });
      r.i = 0; r.stepAt = t + r.step;
      return;
    }
    const lenses = j.kind === 'measure' ? [j.lens!] : [...new Set(r.items.map((id) => this.prop(id)?.lens).filter((l): l is string => !!l))];
    const scope = j.kind === 'measure' ? { features: j.scope!.features.slice() } : { proposals: r.items.slice() };
    this.runs.push({ id: r.runId, started_at: at, updated_at: at, phase: j.kind === 'measure' ? 'measure' : 'execute', status: 'running', lenses, scope, model: 'sample', note: RUN_NOTE_PREFIX + j.id });
    this.setJob(r, { status: 'running', started_at: at, run_id: r.runId });
    r.i = 0; r.stepAt = t + r.step;
    this.open(r);
  }

  /** The current item starts: a feature is read, or a proposal goes to executing. */
  private open(r: Rec) {
    const j = r.job, x = r.items[r.i];
    if (x === undefined || j.kind === 'release') return;
    if (j.kind === 'measure') { this.log(r.runId, 'reading', 'reading ' + x, x, j.lens); return; }
    const p = this.prop(x);
    if (p && p.status === 'approved') { this.setProp(x, { status: 'executing', updated_at: this.iso() }); this.log(r.runId, 'executing', 'building ' + p.title, p.feature, p.lens); }
  }

  /** The current item finishes: the feature is measured (or found out of scope for a temporary lens), or the proposal is committed. */
  private close(r: Rec) {
    const j = r.job, x = r.items[r.i], P = this.prod!, at = this.iso();
    if (x === undefined) return;
    if (j.kind === 'release') { const line = this.train.step(j, x, r.runId); this.setJob(r, { log_tail: [...(j.log_tail ? j.log_tail.split('\n') : []), line].slice(-LOG_LINES).join('\n') }); return; }
    if (j.kind === 'measure') {
      const lens = j.lens!, m = P.manifest(lens);
      if (!m) { this.log(r.runId, 'error', lens + ' is no longer enabled', x, lens); return; }
      if (TEMP_LENS_ID.test(lens) && rand01(x + '|' + lens + '|impact') < NO_IMPACT) {
        let s = this.na.get(lens); if (!s) this.na.set(lens, (s = new Set()));
        s.add(x);
        this.log(r.runId, 'measured', 'no impact on ' + x, x, lens);
        return;
      }
      const fs = m.fields.filter((f) => f.metric && !f.source && NUMERIC.has(f.type));
      for (const f of fs) {
        const value = P.value(x, lens, f.key) ?? fresh(f, x, lens);
        this.ms.push({ id: ++this.mId, run_id: r.runId, feature: x, lens, metric: f.key, value, method: f.metric!.method, evidence: 'Kettle sample scan (simulated)', measured_at: at, ...(f.unit ? { unit: f.unit } : {}) });
      }
      this.log(r.runId, 'measured', fs.length ? 'measured ' + fs.length + ' metric' + (fs.length === 1 ? '' : 's') + ' on ' + x : 'judged ' + x, x, lens);
      return;
    }
    const p = this.prop(x);
    if (!p || p.status !== 'executing') return; // declined or settled elsewhere meanwhile
    const before = p.metric ? this.latest(p.feature, p.lens, p.metric) ?? P.value(p.feature, p.lens, p.metric) : undefined;
    const after = before !== undefined && p.expected_delta !== undefined ? round(before + p.expected_delta) : undefined;
    const sha = hex7(p.id + '|' + r.runId);
    this.setProp(x, { status: 'done', result_sha: sha, updated_at: at, ...(after !== undefined ? { after_value: after } : {}) });
    if (after !== undefined) this.ms.push({ id: ++this.mId, run_id: r.runId, feature: p.feature, lens: p.lens, metric: p.metric!, value: after, method: 'static', evidence: 'after ' + p.id + ' (' + sha + ')', measured_at: at });
    this.log(r.runId, 'committed', p.title + ' · ' + sha, p.feature, p.lens);
  }

  private latest(feature: string, lens: string, metric: string): number | undefined {
    for (let i = this.ms.length - 1; i >= 0; i--) { const m = this.ms[i]; if (m.feature === feature && m.lens === lens && m.metric === metric) return m.value; }
    return undefined;
  }

  private tick() {
    if (this.dead) { this.stop(); return; }
    const t = this.now();
    let moved = false;
    for (const r of this.recs) {
      if (r.job.status !== 'running') continue;
      let stepped = false;
      while (r.i < r.items.length && t >= r.stepAt) {
        this.close(r); r.i++; stepped = true;
        if (r.i < r.items.length) { r.stepAt += r.step; this.open(r); }
      }
      if (r.i >= r.items.length) {
        const at = this.iso(t), err = r.job.kind === 'release' ? this.train.end(r.job).error : undefined;
        this.setRun(r.runId, { status: err ? 'failed' : 'done', ended_at: at, updated_at: at });
        // a failed job exits non-zero, as a real run does (jobs.server.ts passes the CLI's code through): the
        // workbench paints the figure red only when it is non-zero, so exit 0 on a failure read as a clean run
        this.setJob(r, { status: err ? 'failed' : 'done', ended_at: at, exit_code: err ? 1 : 0, ...(err ? { error: err } : {}) });
        stepped = true;
      } else if (stepped) this.setRun(r.runId, { updated_at: this.iso(t) });
      moved ||= stepped;
    }
    if (!moved) return;
    this.pump();
    this.changed();
  }
}

const round = (v: number) => Math.round(v * 100) / 100;
/** A first reading for a field with no value yet: deterministic in the field's range (percent 0..100; else min..max, or a small span). */
function fresh(f: LensField, feature: string, lens: string): number {
  const lo = f.min ?? 0, m = f.metric;
  let hi = f.max ?? (f.type === 'percent' ? 100 : m?.warn_at ? m.warn_at * 2 : m?.target ? m.target * 3 : 10);
  if (!(hi > lo)) hi = lo + 10;
  const v = lo + rand01(feature + '|' + lens + '|' + f.key) * (hi - lo);
  return f.type === 'integer' ? Math.round(v) : round(v);
}
