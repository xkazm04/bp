// A live answer's track: where one decided proposal stands, read from the store's own record (the proposal row, the
// job registry's jobs, its `after` readings and pack, its release, and the product's CURRENT readings), so it survives
// a reload and needs no schema change. Pure and free of '@/' value imports: Node runs it as-is.
//
//   saving (the decision's POST is out) -> approved -> building (an execute job holds it) -> built on branch (its
//   `after` reading, taken on the pack branch, labelled as such) -> accepted -> released -> confirmed or not, by a
//   current reading taken AFTER the release meeting the expected value. Missing evidence reads `unknown`, never good.
//
// Honesty rules: a branch reading is never the product's state (derive.ts isCurrent); a current reading taken before
// the release is an observation, not evidence (a later reading is not caused by the change); `confirmed` needs a
// reading after the release that meets the expected value (baseline + expected_delta, in the delta's direction).
// Landed: an `accepted` item git says is already on the base branch (TrackOpts.landed) is judged by the same rule, with
// its landing time standing in for the release's: 'landed · held', 'landed · short of expected' or 'landed · not measured
// since' (stages confirmed / not-confirmed / unknown, so every reader of a stage counts it as it counts a release's).
// Eligibility (owned here, once): a reading after the release or landing judges it only when its method and unit match
// the baseline's, and, when it records its commit, that commit contains the landing (TrackOpts.contains, read from git by
// the server). A reading with no commit is judged by time and says so ('by time; commit not recorded'). A wrong-branch,
// unplaced or changed-method reading cannot judge: it is named with why, and the newest eligible one judges instead.
// A target outside the metric's declared bounds (TrackOpts.bounds: the lens field's min / max) stays unresolved.
// Items judged by the same reading form one observation cohort (Track.cohort, cohortsOf): one shared observation.
import { isCurrent, metricKey } from './derive.ts';
import type { ScanJob } from './jobs.ts';
import { containsOf, landedIn, type Landing, type LandedMap, type Landings } from './landed.ts';
import type { MetricMethod } from '../standard/types.ts';
import type { Measurement, Proposal, ProposalStatus, ScanSnapshot } from './types.ts';

export type TrackStage = 'saving' | 'approved' | 'declined' | 'building' | 'failed' | 'built' | 'rework' | 'accepted' | 'descoped' | 'confirmed' | 'not-confirmed' | 'unknown';
/** The one verb a track offers in place (the live steer verbs, src/lib/model/live-steer.ts). */
export type TrackNext = 'build' | 'measure' | 'stop';

export interface Track {
  id: string;
  feature: string;
  lens: string;
  title: string;
  stage: TrackStage;
  /** The store's status (for `saving`: still `proposed` there). */
  status: ProposalStatus;
  /** What the tile says, short: "approved · expected 52", "built on branch 46 (expected 52)". */
  label: string;
  /** The record in full, for the hover card and the detail. */
  lines: string[];
  metric?: string;
  unit?: string;
  baseline?: number;
  expected?: number;
  /** The item's `after` reading on its pack branch. */
  branch?: number;
  branchName?: string;
  /** The product's latest current reading of the metric, and whether it was taken after the release (evidence) or not (an observation). */
  current?: number;
  currentAt?: string;
  /** How that reading was taken (judgement, static, probe): a judged metric is noisy. */
  currentMethod?: MetricMethod;
  evidence?: boolean;
  /** How the judging reading earned its place: its commit contains the landing, or it was taken after it (commit not recorded). */
  by?: 'commit' | 'time';
  /** Why a reading taken after the release or landing could not judge it (wrong branch, changed method or unit), in words. */
  ineligible?: string;
  /** The expected value lies outside the metric's declared bounds: unresolved, never short. */
  outOfBounds?: Bounds;
  /** The observation cohort: every item judged by the same reading (store row) shares it (cohortsOf counts them once). */
  cohort?: string;
  job?: string;
  commit?: string;
  release?: string;
  /** Where its change already is on the base branch (read from git: TrackOpts.landed), whatever the store's status. */
  landed?: Landing;
  decidedAt?: string;
  decidedBy?: string;
  next: TrackNext | null;
  /** When the track last moved (decided_at, else updated_at): recent ones and unfinished ones are shown. */
  at: string;
}

/** A decision made here and not yet in the snapshot: `saving` while the POST is out; `saved` with the row the store answered (or the
 *  row another decision left, on a 409) until the snapshot catches up. */
export type Pending = { state: 'saving'; decision: 'approve' | 'decline' } | { state: 'saved'; p: Proposal };

export interface TrackOpts {
  jobs?: readonly ScanJob[];
  pending?: ReadonlyMap<string, Pending>;
  /** What git says already landed on the base branch (scan/landed.ts), by proposal id: carried on the track as `landed`,
   *  and for an `accepted` item its landing time stands in for the release's (judged by the same confirm rule). */
  landed?: LandedMap;
  /** Whether measured commit `measured` contains landing commit `landing` (git, read by the server: release.server.ts
   *  landings' `contains`): true, false, or undefined when git could not say. A pure lookup: core never shells. */
  contains?: (landing: string, measured: string) => boolean | undefined;
  /** A metric's declared bounds (the lens field's min / max: boundsOf). */
  bounds?: (lens: string, metric: string) => Bounds | undefined;
}
/** What git said landed (with its ancestry) and the lenses' bounds, as trackOf takes them: the one way every reader builds
 *  them. The same answer and lenses give the same lookups (cached by identity), so a reader's cache keyed by them holds. */
export function evidenceOpts(l: Landings | null | undefined, lenses?: Parameters<typeof boundsOf>[0]): Pick<TrackOpts, 'landed' | 'contains' | 'bounds'> {
  const o: Pick<TrackOpts, 'landed' | 'contains' | 'bounds'> = {};
  if (l?.state === 'known') {
    o.landed = l.items;
    let c = CONTAINS.get(l);
    if (c === undefined) CONTAINS.set(l, (c = containsOf(l) ?? null));
    if (c) o.contains = c;
  }
  if (lenses) { let b = BOUNDS.get(lenses); if (!b) BOUNDS.set(lenses, (b = boundsOf(lenses))); o.bounds = b; }
  return o;
}
const CONTAINS = new WeakMap<object, TrackOpts['contains'] | null>(), BOUNDS = new WeakMap<object, NonNullable<TrackOpts['bounds']>>();
/** A numeric lens field's declared bounds. */
export interface Bounds { min?: number; max?: number }

interface BoundField { key?: string; min?: number; max?: number }
/** The bounds lookup from lens manifests (`{ id, fields }`, or a map's `{ id, manifest: { fields } }`). */
export function boundsOf(lenses: readonly { id?: string; fields?: readonly BoundField[]; manifest?: { fields?: readonly BoundField[] } }[]): (lens: string, metric: string) => Bounds | undefined {
  const by = new Map<string, Bounds>();
  for (const l of lenses) for (const f of l.fields ?? l.manifest?.fields ?? []) {
    if (!l.id || !f.key || (typeof f.min !== 'number' && typeof f.max !== 'number')) continue;
    by.set(l.id + '|' + f.key, { ...(typeof f.min === 'number' ? { min: f.min } : {}), ...(typeof f.max === 'number' ? { max: f.max } : {}) });
  }
  return (lens, metric) => by.get(lens + '|' + metric);
}
const outside = (v: number, b?: Bounds) => !!b && ((b.min !== undefined && v < b.min) || (b.max !== undefined && v > b.max));
/** "min 0", "min 0, max 100". */
export const boundWords = (b: Bounds): string => [b.min !== undefined ? 'min ' + fmt(b.min) : '', b.max !== undefined ? 'max ' + fmt(b.max) : ''].filter(Boolean).join(', ');

/** The one confirm rule: a value meets the expected one at or past it, in the expected delta's direction. */
export const meetsTarget = (value: number, expected: number, d: number): boolean => (d > 0 ? value >= expected : value <= expected);

/** Whether a reading taken after the release or landing may judge it: `by` how it earned that, or `why` not. */
export type Eligibility = { ok: true; by: 'commit' | 'time' } | { ok: false; why: string };
/** The one eligibility rule: method and unit as the baseline's (either unrecorded: compatible), and a recorded commit
 *  that contains the landing (no landing commit known, or no commit recorded: judged by time). */
export function eligibility(m: Pick<Measurement, 'method' | 'unit' | 'commit_sha'>, base: Pick<Measurement, 'method' | 'unit'> | undefined, landing: string | undefined, contains?: TrackOpts['contains']): Eligibility {
  if (base?.method && m.method && base.method !== m.method) return { ok: false, why: `method changed: ${base.method} at the baseline, ${m.method} now` };
  if (base?.unit && m.unit && base.unit !== m.unit) return { ok: false, why: `unit changed: ${base.unit} at the baseline, ${m.unit} now` };
  if (!m.commit_sha || !landing) return { ok: true, by: 'time' };
  const c = contains?.(landing, m.commit_sha);
  if (c === true) return { ok: true, by: 'commit' };
  return { ok: false, why: c === false ? `measured at ${m.commit_sha.slice(0, 7)}, which does not contain the landing ${landing.slice(0, 7)} (another branch)` : `measured at ${m.commit_sha.slice(0, 7)}, which git here cannot place against the landing ${landing.slice(0, 7)}` };
}

/** Cohort id -> the ids of the tracks it judged (only tracks a reading judged): items sharing one observation. Trust and
 *  outcome reporting count a cohort once (`cohortsOf(ts).size` observations), while each item keeps its own target result. */
export function cohortsOf(tracks: readonly (Pick<Track, 'id' | 'cohort'> | null)[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const t of tracks) if (t?.cohort) { const a = out.get(t.cohort); if (a) a.push(t.id); else out.set(t.cohort, [t.id]); }
  return out;
}

const FINAL: ReadonlySet<TrackStage> = new Set(['confirmed', 'declined', 'descoped']);
/** How long a finished track stays on its tile; unfinished ones stay until they finish. */
export const TRACK_DAYS = 14;

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
const day = (iso?: string) => (iso ? iso.slice(0, 10) : '');
/** The readings grouped once per table: by proposal, and (current readings only) by feature + lens + metric, each in table order so
 *  the loops below see the rows exactly as a scan of the table would. Cached by the array's identity and length, as derive.ts's index is. */
interface ReadingIndex { n: number; byProposal: Map<string, Measurement[]>; current: Map<string, Measurement[]> }
const READINGS = new WeakMap<readonly Measurement[], ReadingIndex>();
function readingsOf(ms: readonly Measurement[]): ReadingIndex {
  let ix = READINGS.get(ms);
  if (ix && ix.n === ms.length) return ix;
  ix = { n: ms.length, byProposal: new Map(), current: new Map() };
  const push = (m: Map<string, Measurement[]>, k: string, x: Measurement) => { const a = m.get(k); if (a) a.push(x); else m.set(k, [x]); };
  for (const m of ms) {
    if (m.proposal_id) push(ix.byProposal, m.proposal_id, m);
    if (isCurrent(m)) push(ix.current, metricKey(m.feature, m.lens, m.metric), m);
  }
  READINGS.set(ms, ix);
  return ix;
}
const latest = (xs: readonly Measurement[]): Measurement | undefined => { let r: Measurement | undefined; for (const m of xs) if (!r || m.measured_at > r.measured_at || (m.measured_at === r.measured_at && m.id > r.id)) r = m; return r; };

/** Where proposal `id` stands; null when it is not decided (a `proposed` row is a question, not a track) or unknown. */
export function trackOf(scan: Pick<ScanSnapshot, 'proposals' | 'measurements' | 'packs' | 'releases'>, id: string, opts: TrackOpts = {}): Track | null {
  const pend = opts.pending?.get(id);
  const row = scan.proposals.find((x) => x.id === id);
  const p = pend?.state === 'saved' && (!row || row.status === 'proposed' || row.updated_at < pend.p.updated_at) ? pend.p : row;
  if (!p) return null;
  const saving = pend?.state === 'saving' && p.status === 'proposed';
  if (p.status === 'proposed' && !saving) return null;

  // the numbers: baseline (the item's `before` reading, else the latest current one before the decision), expected, branch, current
  const unit = (m?: Measurement) => (m?.unit ? ' ' + m.unit : '');
  let mine: readonly Measurement[] = [], cur: readonly Measurement[] = [];
  if (p.metric) {
    const ix = readingsOf(scan.measurements);
    mine = (ix.byProposal.get(p.id) ?? []).filter((m) => m.lens === p.lens && m.metric === p.metric);
    cur = ix.current.get(metricKey(p.feature, p.lens, p.metric)) ?? [];
  }
  const decided = p.decided_at ?? (saving ? undefined : p.updated_at);
  const before = latest(mine.filter((m) => m.phase === 'before')) ?? latest(cur.filter((m) => !decided || m.measured_at <= decided));
  const after = latest(mine.filter((m) => m.phase === 'after'));
  const now = latest(cur);
  const d = p.expected_delta;
  const expected = before && d !== undefined && d !== 0 ? before.value + d : undefined;
  const u = unit(now ?? before ?? after);
  const t: Track = { id: p.id, feature: p.feature, lens: p.lens, title: p.title, stage: 'unknown', status: p.status, label: '', lines: [], next: null, at: p.decided_at ?? p.updated_at };
  if (p.metric) t.metric = p.metric;
  if (u) t.unit = u.trim();
  if (before) t.baseline = before.value;
  if (expected !== undefined) t.expected = expected;
  if (p.decided_at) t.decidedAt = p.decided_at;
  if (p.decided_by) t.decidedBy = p.decided_by;
  if (p.result_sha ?? p.commit_sha) t.commit = (p.result_sha ?? p.commit_sha)!.slice(0, 7);
  if (p.release_id) t.release = p.release_id;
  const landing = landedIn(opts.landed, p.id);
  if (landing) t.landed = landing;
  const pack = p.pack_id ? scan.packs.find((x) => x.id === p.pack_id) : undefined;
  if (after) { t.branch = after.value; t.branchName = pack?.branch ?? 'its branch'; }
  const exp = expected !== undefined ? ' (expected ' + fmt(expected) + ')' : '';
  const job = (opts.jobs ?? []).find((j) => j.kind === 'execute' && (j.status === 'queued' || j.status === 'running') && j.proposals?.includes(p.id));
  if (job) t.job = job.id;

  // released: when its release was merged or tagged (else the row's own time); an accepted item already on the base
  // branch: when it landed there (git's committer time, as UTC like the store's times)
  const rel = p.release_id ? scan.releases.find((r) => r.id === p.release_id) : undefined;
  const landedAt = p.status === 'accepted' && landing ? utc(landing.at) : undefined;
  const releasedAt = p.status === 'released' ? (rel && (rel.status === 'tagged' || rel.status === 'merged') ? rel.updated_at : p.updated_at) : landedAt;
  const since = landedAt ? 'it landed' : 'the release';
  // the reading that judges it: the newest one after `releasedAt` that is eligible (eligibility); a newer one that is not
  // is named with why. Before that time a reading is an observation, as before.
  let ev: Measurement | undefined, bad: { m: Measurement; why: string } | undefined;
  if (releasedAt) {
    const sha = landing?.sha;
    for (const m of [...cur].sort((a, b) => (a.measured_at < b.measured_at ? 1 : a.measured_at > b.measured_at ? -1 : b.id - a.id))) {
      if (m.measured_at <= releasedAt) break;
      const e = eligibility(m, before, sha, opts.contains);
      if (e.ok) { ev = m; t.by = e.by; break; }
      bad ??= { m, why: e.why };
    }
  }
  if (bad) t.ineligible = bad.why;
  const shown = ev ?? now;
  if (shown) { t.current = shown.value; t.currentAt = shown.measured_at; if (shown.method) t.currentMethod = shown.method; t.evidence = !!ev; }
  if (ev) t.cohort = 'm:' + ev.id;
  const bounds = p.metric ? opts.bounds?.(p.lens, p.metric) : undefined;
  if (expected !== undefined && outside(expected, bounds)) t.outOfBounds = bounds;

  switch (p.status) {
    case 'proposed': t.stage = 'saving'; t.label = 'saving · ' + (pend?.state === 'saving' ? pend.decision : 'decision') + '…'; break;
    case 'approved':
      if (job) { t.stage = 'building'; t.label = 'building · ' + job.id; t.next = 'stop'; }
      else { t.stage = 'approved'; t.label = 'approved' + (expected !== undefined ? ' · expected ' + fmt(expected) + u : ''); t.next = 'build'; }
      break;
    case 'executing': t.stage = 'building'; t.label = 'building' + (job ? ' · ' + job.id : ''); if (job) t.next = 'stop'; break;
    case 'failed': t.stage = 'failed'; t.label = 'build failed'; break;
    case 'done': t.stage = 'built'; t.label = after ? 'built on branch ' + fmt(after.value) + exp : 'built on branch' + exp; break;
    case 'rework': t.stage = 'rework'; t.label = 'sent back for rework'; break;
    case 'descoped': t.stage = 'descoped'; t.label = 'descoped'; break;
    case 'declined': t.stage = 'declined'; t.label = 'declined'; break;
    case 'accepted':
      if (!landedAt) { t.stage = 'accepted'; t.label = 'accepted · awaiting release'; break; }
    // falls through: an accepted item on the base branch is judged as a released one, from its landing
    case 'released': {
      const on = landedAt ? 'landed' : 'released';
      if (t.outOfBounds) { t.stage = 'unknown'; t.label = on + ' · target out of bounds (expected ' + fmt(expected!) + u + ', ' + boundWords(t.outOfBounds) + ')'; }
      else if (!ev || expected === undefined || !d) { t.stage = 'unknown'; t.label = ev ? on + ' · measured ' + fmt(ev.value) + u : bad ? on + ' · not counted: ' + bad.why : on + ' · not measured since'; t.next = 'measure'; }
      else if (meetsTarget(ev.value, expected, d)) { t.stage = 'confirmed'; t.label = (landedAt ? 'landed · held · measured ' : 'confirmed · measured ') + fmt(ev.value) + exp; }
      else { t.stage = 'not-confirmed'; t.label = (landedAt ? 'landed · short of expected · measured ' : 'measured ') + fmt(ev.value) + ', expected ' + fmt(expected); t.next = 'measure'; }
      break;
    }
  }

  // the record in words: decision, expected, branch, current (evidence or observation), job / commit / release
  const L = t.lines;
  if (saving) L.push('Saving your decision (' + (pend?.state === 'saving' ? pend.decision : '') + ') to the product’s store…');
  else if (p.decided_at || p.decided_by) L.push(title(p.status === 'declined' ? 'declined' : 'approved') + (p.decided_by ? ' by ' + p.decided_by : '') + (p.decided_at ? ' on ' + day(p.decided_at) : ''));
  if (p.metric) {
    L.push(expected !== undefined && before ? `Expected ${p.metric}: ${fmt(expected)}${u} (${fmt(before.value)} ${d! > 0 ? '+' : '−'} ${fmt(Math.abs(d!))})` : `Expected: not stated as a number`);
    if (after) L.push(`Built on ${t.branchName}: ${fmt(after.value)}${unit(after)}${after.commit_sha ? ' at ' + after.commit_sha.slice(0, 7) : ''} (a branch reading, not the product)`);
    if (ev) L.push(`Product now: ${fmt(ev.value)}${unit(ev)}, measured ${day(ev.measured_at)} after ${since} (${t.by === 'commit' ? 'by commit: ' + ev.commit_sha!.slice(0, 7) + ' contains the landing' : 'by time; commit not recorded'})`);
    else if (now && !bad) L.push(`Product now: ${fmt(now.value)}${unit(now)}, measured ${day(now.measured_at)} (an observation${releasedAt ? ' from before ' + since : ': the change is not released'})`);
    else if (!now) L.push('Product now: not measured');
    if (bad) L.push(`Not counted: ${fmt(bad.m.value)}${unit(bad.m)} measured ${day(bad.m.measured_at)}: ${bad.why}`);
    if (t.outOfBounds) L.push(`Target out of bounds: expected ${fmt(expected!)}${u} lies outside the declared bounds of ${p.metric} (${boundWords(t.outOfBounds)}); unresolved until the target is corrected`);
  } else L.push('No metric: there is no number to confirm it by');
  if (job) L.push(`Build job ${job.id} (${job.status})`);
  if (t.commit) L.push('Commit ' + t.commit);
  if (landing) L.push(`Landed as ${landing.sha.slice(0, 7)} on ${day(landing.at)} (read from git${landing.by === 'patch-id' ? ', by its patch' : ''})`);
  if (p.release_id) L.push('Release ' + (rel?.version ?? p.release_id) + (rel ? ' (' + rel.status + ')' : ''));
  if (t.stage === 'confirmed') L.push((landedAt ? 'Held' : 'Confirmed') + `: a reading taken after ${since} meets the expected value`);
  else if (t.stage === 'not-confirmed') L.push((landedAt ? 'Short of expected' : 'Not confirmed') + `: the reading after ${since} falls short of the expected value`);
  else if (t.stage === 'unknown' && !t.outOfBounds) L.push('Unknown: ' + (expected === undefined ? 'no expected value to compare with' : bad && !ev ? `no eligible reading since ${since}` : `no reading of the product since ${since}`));
  return t;
}
const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** An ISO time as UTC ('…Z'), so it compares as text with the store's; unparseable stays as it is. */
const utc = (iso: string) => { const ms = Date.parse(iso); return Number.isFinite(ms) ? new Date(ms).toISOString() : iso; };

/** Where a change on the base branch stands, read from its track's stage (never re-judged): held (confirmed), short of
 *  expected (not confirmed), not measured since, or no expected value to judge by. Null for a track not on main (neither
 *  released nor an accepted item git says landed). */
export type MainOutcome = 'held' | 'short' | 'unmeasured' | 'no-target' | 'out-of-bounds';
export function mainOutcome(t: Pick<Track, 'status' | 'stage' | 'landed' | 'expected'> & Pick<Partial<Track>, 'outOfBounds'>): MainOutcome | null {
  if (t.status !== 'released' && !(t.status === 'accepted' && t.landed)) return null;
  return t.outOfBounds ? 'out-of-bounds' : t.stage === 'confirmed' ? 'held' : t.stage === 'not-confirmed' ? 'short' : t.expected === undefined ? 'no-target' : 'unmeasured';
}

/** The rework note a short landed item starts from: "Short on master: standardsPct 100 on pack/des-2 -> 50 on 2026-10-30,
 *  expected 100" (its branch reading, the reading on main and its day, the expected value). Null unless short on main. */
export function shortNote(t: Track, base: string): string | null {
  if (!t.landed || mainOutcome(t) !== 'short' || t.current === undefined || t.expected === undefined) return null;
  const u = t.unit ? ' ' + t.unit : '';
  const from = t.branch !== undefined ? fmt(t.branch) + u + ' on ' + (t.branchName ?? 'its branch') + ' -> ' : '';
  return `Short on ${base}: ${t.metric ?? 'the metric'} ${from}${fmt(t.current)}${u} on ${day(t.currentAt)}, expected ${fmt(t.expected)}${u}`;
}

/** Every track to show: decided in the last TRACK_DAYS days, or not finished (not confirmed, declined or descoped), plus the
 *  decisions made here that the snapshot has not caught up with. Newest first. */
export function tracksOf(scan: Pick<ScanSnapshot, 'proposals' | 'measurements' | 'packs' | 'releases'>, nowMs: number, opts: TrackOpts = {}): Track[] {
  const out: Track[] = [], since = new Date(nowMs - TRACK_DAYS * 86400000).toISOString(), seen = new Set<string>();
  const take = (id: string) => {
    if (seen.has(id)) return; seen.add(id);
    const t = trackOf(scan, id, opts);
    if (t && (t.stage === 'saving' || t.at >= since || !FINAL.has(t.stage) || opts.pending?.has(id))) out.push(t);
  };
  for (const p of scan.proposals) if (p.status !== 'proposed') take(p.id);
  if (opts.pending) for (const id of opts.pending.keys()) take(id);
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}
