// The Kettle sample's stand-in for the Claude Code CLI: scans and execute runs that play out in the
// browser and emit the same store rows a real lens-scan run writes, so the model applies them on the
// live path (applyScan) and every scan view is shared with live products.
// A timer runs only while a job runs (never a rAF); every change notifies once per tick. Pure and free of
// '@/' value imports, so Node can drive it (the scan-package probes).
import type { Activity, ActivityKind, Measurement, Proposal, Run, ScanSnapshot } from '@/lib/scan/types';
import type { ScanJob, ScanScope } from '@/lib/scan/jobs';
import type { LensField, LensManifest } from '@/lib/standard/types';
import { RUN_NOTE_PREFIX, TEMP_LENS_ID } from '../scan/jobs.ts';

/** What the sim needs of the product: bound once the model is built (`ScanSim.bind`). */
export interface ScanSimProduct {
  /** Base feature slugs in layout order (left to right): what `all` walks, and the order a scope is walked in. */
  order: readonly string[];
  /** An enabled lens's manifest, else undefined (unknown or disabled lenses cannot be scanned). */
  manifest(lens: string): LensManifest | undefined;
  /** The value a feature's facet holds now for a lens field (a reading laid over it included), else undefined. */
  value(feature: string, lens: string, key: string): number | undefined;
}

/** One feature per STEP_MS; an execute job takes about EXEC_MS over all its proposals. */
const STEP_MS = 1200, EXEC_MS = 15000, TICK_MS = 200, MAX_RUNNING = 3, MAX_QUEUED = 16, MAX_IDS = 50;
/** Share of features a temporary lens finds nothing to say about (deterministic per feature and lens). */
const NO_IMPACT = 0.4;
const KINDS = new Set(['feature', 'bay', 'room', 'wing', 'all']);
const NUMERIC = new Set(['number', 'integer', 'percent', 'money']);

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

  constructor(opts: { now: () => number; findings: readonly Proposal[] }) {
    this.now = opts.now;
    this.props = opts.findings.slice();
    this.props.forEach((p, i) => this.pAt.set(p.id, i));
  }

  /** Give the sim the product it scans (the model, once built). Scans refuse until then. */
  bind(p: ScanSimProduct): void { this.prod = p; }
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
      this.snap = { runs: this.runs.slice(), measurements: this.ms.slice(), proposals: this.props.slice(), activity: this.act.slice(), shots: [], coverage: [] };
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
      || (all ? scope.features.length > 0 || scope.id !== undefined : !scope.features.length || scope.features.some((f) => !known.has(f)))) throw refuse(400, 'bad-scope');
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

  dispatch(ids: string[]): { job: ScanJob; approved: string[]; skipped: { id: string; status: string }[] } {
    if (!Array.isArray(ids) || !ids.length || ids.length > MAX_IDS || ids.some((x) => typeof x !== 'string')) throw refuse(400, 'bad-ids');
    const approved: string[] = [], go: string[] = [], skipped: { id: string; status: string }[] = [];
    const at = this.iso();
    for (const pid of [...new Set(ids)]) {
      const p = this.prop(pid);
      if (!p) { skipped.push({ id: pid, status: 'unknown' }); continue; }
      if (p.status === 'proposed') { this.setProp(pid, { status: 'approved', decided_by: 'blueprint', decided_at: at, updated_at: at }); approved.push(pid); go.push(pid); }
      else if (p.status === 'approved') go.push(pid);
      else skipped.push({ id: pid, status: p.status });
    }
    if (!go.length) throw refuse(409, 'Nothing to dispatch: none of them is proposed or approved', { skipped });
    const id = 'sim-' + ++this.nextId;
    const job: ScanJob = { id, kind: 'execute', proposals: go, status: 'queued', queued_at: at };
    this.recs.push({ job, items: go, i: 0, stepAt: 0, step: Math.max(1500, EXEC_MS / go.length), runId: 'run-' + id });
    this.pump();
    this.changed();
    return { job: this.recOf(id)!.job, approved, skipped };
  }

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
    if (x === undefined) return;
    if (j.kind === 'measure') { this.log(r.runId, 'reading', 'reading ' + x, x, j.lens); return; }
    const p = this.prop(x);
    if (p && p.status === 'approved') { this.setProp(x, { status: 'executing', updated_at: this.iso() }); this.log(r.runId, 'executing', 'building ' + p.title, p.feature, p.lens); }
  }

  /** The current item finishes: the feature is measured (or found out of scope for a temporary lens), or the proposal is committed. */
  private close(r: Rec) {
    const j = r.job, x = r.items[r.i], P = this.prod!, at = this.iso();
    if (x === undefined) return;
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
        const at = this.iso(t);
        this.setRun(r.runId, { status: 'done', ended_at: at, updated_at: at });
        this.setJob(r, { status: 'done', ended_at: at, exit_code: 0 });
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
