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
import { isCurrent, metricKey } from './derive.ts';
import type { ScanJob } from './jobs.ts';
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
  evidence?: boolean;
  job?: string;
  commit?: string;
  release?: string;
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
  const pack = p.pack_id ? scan.packs.find((x) => x.id === p.pack_id) : undefined;
  if (after) { t.branch = after.value; t.branchName = pack?.branch ?? 'its branch'; }
  const exp = expected !== undefined ? ' (expected ' + fmt(expected) + ')' : '';
  const job = (opts.jobs ?? []).find((j) => j.kind === 'execute' && (j.status === 'queued' || j.status === 'running') && j.proposals?.includes(p.id));
  if (job) t.job = job.id;

  // released: when its release was merged or tagged (else the row's own time)
  const rel = p.release_id ? scan.releases.find((r) => r.id === p.release_id) : undefined;
  const releasedAt = p.status === 'released' ? (rel && (rel.status === 'tagged' || rel.status === 'merged') ? rel.updated_at : p.updated_at) : undefined;
  if (now) { t.current = now.value; t.currentAt = now.measured_at; t.evidence = !!releasedAt && now.measured_at > releasedAt; }

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
    case 'accepted': t.stage = 'accepted'; t.label = 'accepted · awaiting release'; break;
    case 'descoped': t.stage = 'descoped'; t.label = 'descoped'; break;
    case 'declined': t.stage = 'declined'; t.label = 'declined'; break;
    case 'released': {
      const ev = t.evidence ? now : undefined;
      if (!ev || expected === undefined || !d) { t.stage = 'unknown'; t.label = ev ? 'released · measured ' + fmt(ev.value) + u : 'released · not measured since'; t.next = 'measure'; }
      else if (d > 0 ? ev.value >= expected : ev.value <= expected) { t.stage = 'confirmed'; t.label = 'confirmed · measured ' + fmt(ev.value) + exp; }
      else { t.stage = 'not-confirmed'; t.label = 'measured ' + fmt(ev.value) + ', expected ' + fmt(expected); t.next = 'measure'; }
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
    if (now) L.push(t.evidence ? `Product now: ${fmt(now.value)}${unit(now)}, measured ${day(now.measured_at)} after the release` : `Product now: ${fmt(now.value)}${unit(now)}, measured ${day(now.measured_at)} (an observation${releasedAt ? ' from before the release' : ': the change is not released'})`);
    else L.push('Product now: not measured');
  } else L.push('No metric: there is no number to confirm it by');
  if (job) L.push(`Build job ${job.id} (${job.status})`);
  if (t.commit) L.push('Commit ' + t.commit);
  if (p.release_id) L.push('Release ' + (rel?.version ?? p.release_id) + (rel ? ' (' + rel.status + ')' : ''));
  if (t.stage === 'confirmed') L.push('Confirmed: a reading taken after the release meets the expected value');
  else if (t.stage === 'not-confirmed') L.push('Not confirmed: the reading after the release falls short of the expected value');
  else if (t.stage === 'unknown') L.push('Unknown: ' + (expected === undefined ? 'no expected value to compare with' : 'no reading of the product since the release'));
  return t;
}
const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

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
