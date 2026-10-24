// Scans as the plan draws them, shared by live products and the Kettle sim: the scopes a right-click offers at a
// place (`scopesAt`), a job's progress read from the store rows (`jobProgress`), and what a scan of a scope would
// repeat (`scopeFacts`: the job already on it, the last read, the queue room). Pure.
import type { Layout } from '../model/layout.ts';
import type { Product } from '../model/product.ts';
import type { ScanSnapshot } from './types.ts';
import { isJobNote, MAX_QUEUED, type ScanJob, type ScanScope, type ScanScopeKind } from './jobs.ts';
import { lastRead, measuredFeatures } from './derive.ts';
import { ago, jobLiveness } from './liveness.ts';

export interface ScopeOption { kind: ScanScopeKind; /** "Feature", "Bay", "Room", "Wing", "Everything". */ title: string; scope: ScanScope }
type Geo = { P: Product; L: Layout };

/** Base slugs of some features (a clone at `?scale` > 1 maps to its base: the scan measures the base, every line shows it). */
const slugs = (fs: readonly { slug: string }[]): string[] => [...new Set(fs.map((f) => f.slug))];

/**
 * The scopes a right-click offers, narrowest first: the feature tile under the pointer, then its bay, room and
 * wing, then everything. Ids are base ids (capability, domain, wing key), so a scope reads the same at any
 * `?scale`. A wider scope whose features equal a narrower one's is dropped (a room of one bay; a live product's
 * wing is its one room).
 */
export function scopesAt(M: Geo, chain: readonly { t: string; id: string }[], tile: string | null): ScopeOption[] {
  const { L } = M, out: ScopeOption[] = [];
  const T = tile ? L.TILE[tile] : undefined;
  if (T) out.push({ kind: 'feature', title: 'Feature', scope: { kind: 'feature', id: T.f.slug, label: T.f.name, features: [T.f.slug] } });
  const at = (t: string) => chain.find((c) => c.t === t)?.id;
  const bay = L.BAY[at('bay') ?? T?.bay.id ?? ''], room = L.ROOM[at('room') ?? T?.room.id ?? ''], wing = L.WING[at('wing') ?? T?.wing.id ?? ''];
  if (bay) out.push({ kind: 'bay', title: 'Bay', scope: { kind: 'bay', id: bay.cap.base, label: bay.cap.name, features: slugs(bay.feats) } });
  if (room) out.push({ kind: 'room', title: 'Room', scope: { kind: 'room', id: room.d.base, label: room.d.name + ' room', features: slugs(room.feats) } });
  if (wing) out.push({ kind: 'wing', title: 'Wing', scope: { kind: 'wing', id: wing.def.k, label: wing.def.name + ' wing', features: slugs(wing.feats) } });
  const kept: ScopeOption[] = [];
  for (const o of out) {
    const prev = kept[kept.length - 1];
    if (prev && prev.scope.features.length === o.scope.features.length && o.scope.features.every((f) => prev.scope.features.includes(f))) continue;
    kept.push(o);
  }
  kept.push({ kind: 'all', title: 'Everything', scope: { kind: 'all', label: 'Everything', features: [] } });
  return kept;
}

export interface JobProgress {
  /** Base slugs judged so far in this job's run (measured, or found out of scope), within the scope. */
  done: Set<string>;
  /** The feature of the run's latest reading or measured row, within the scope: a run can read wider than its job was pointed at (a scope that matched nothing falls back to every feature), and a feature outside it is never named as the one being read. */
  current?: string;
  n: number;
  m: number;
}

/** A measure job's progress from the store rows: its run (by `run_id`, else the `bp-job:<id>` note), the features measured in it on its lens, the one being read. */
export function jobProgress(job: ScanJob, scan: ScanSnapshot | undefined, total: number): JobProgress {
  const sc = job.scope, all = !sc || sc.kind === 'all', m = all ? total : sc.features.length;
  const done = new Set<string>();
  const run = scan && (scan.runs.find((r) => r.id === job.run_id) ?? scan.runs.find((r) => isJobNote(r.note, job.id)));
  if (!run || !scan || !job.lens) return { done, n: 0, m };
  const want = all ? null : new Set(sc!.features);
  for (const f of measuredFeatures(scan, run.id, job.lens)) if (!want || want.has(f)) done.add(f);
  let current: string | undefined;
  for (const a of scan.activity) {
    if (a.run_id !== run.id || a.lens !== job.lens || !a.feature || (a.kind !== 'reading' && a.kind !== 'measured')) continue;
    if (a.kind === 'measured' && (!want || want.has(a.feature))) done.add(a.feature); // judged with nothing to measure (a temporary lens's "no impact")
    if (!want || want.has(a.feature)) current = a.feature;
  }
  return { done, current, n: Math.min(done.size, m), m };
}

/** The queue as the job registry caps it (jobs.server.ts refuses the next one 429; the Kettle sim mirrors it): every kind counts. */
export interface QueueRoom { running: number; queued: number; full: boolean; /** The server's own words, when full. */ why?: string }
export function queueRoom(jobs: readonly ScanJob[]): QueueRoom {
  let running = 0, queued = 0;
  for (const j of jobs) if (j.status === 'running') running++; else if (j.status === 'queued') queued++;
  const full = queued >= MAX_QUEUED;
  return full ? { running, queued, full, why: `${MAX_QUEUED} jobs are already queued` } : { running, queued, full };
}

/** What a scan of `lens` over `features` would repeat, read from what the app already holds. */
export interface ScopeFacts {
  /** A queued or running measure job of this lens whose scope overlaps (running first, then stalled, then queued; the widest overlap wins a tie). */
  busy?: { status: 'running' | 'stale' | 'queued'; jobId: string; overlap: number; of: number };
  /** Features with a current (isCurrent) reading of this lens, of the asked, and the oldest and newest of their latest readings. */
  read: { measured: number; of: number; oldestMs?: number; newestMs?: number };
  queue: QueueRoom;
}

const RANK = { running: 0, stale: 1, queued: 2 } as const;
/**
 * The facts a scan menu item states before the click: is this lens already scanning (or queued over) these
 * features, when did it last read them, and does the queue have room. `features` are the asked base slugs (every
 * feature for an `all` scope). Informs only: a duplicate is the owner's call (parallel scans of one lens), the
 * queue cap is the one refusal. Pure; `now` decides a silent running job is stalled (jobLiveness).
 */
export function scopeFacts(a: { jobs: readonly ScanJob[]; scan: ScanSnapshot | undefined; lens: string; features: readonly string[]; now: number }): ScopeFacts {
  const of = a.features.length, ask = new Set(a.features);
  let busy: ScopeFacts['busy'];
  for (const j of a.jobs) {
    if (j.kind !== 'measure' || j.lens !== a.lens || (j.status !== 'queued' && j.status !== 'running')) continue;
    const sc = j.scope, overlap = !sc || sc.kind === 'all' ? of : sc.features.filter((f, i, fs) => ask.has(f) && fs.indexOf(f) === i).length;
    if (!overlap) continue;
    const status = jobLiveness(j, a.scan, a.now) as 'running' | 'stale' | 'queued';
    if (!busy || RANK[status] < RANK[busy.status] || (RANK[status] === RANK[busy.status] && overlap > busy.overlap)) busy = { status, jobId: j.id, overlap, of };
  }
  const by = a.scan ? lastRead(a.scan.measurements).get(a.lens) : undefined;
  let measured = 0, oldestMs: number | undefined, newestMs: number | undefined;
  for (const f of ask) {
    const t = by?.get(f);
    if (t === undefined) continue;
    measured++;
    if (oldestMs === undefined || t < oldestMs) oldestMs = t;
    if (newestMs === undefined || t > newestMs) newestMs = t;
  }
  const read: ScopeFacts['read'] = measured ? { measured, of, oldestMs, newestMs } : { measured, of };
  return busy ? { busy, read, queue: queueRoom(a.jobs) } : { read, queue: queueRoom(a.jobs) };
}

/** The facts in words: `n` for an item's count column ("running 4/12", "read 9/12 · 2 d"), `tag` a busy lens's visible suffix, `say` its accessible sentence. */
export function factsWords(f: ScopeFacts, now: number): { n: string; tag?: string; say: string } {
  const b = f.busy, r = f.read;
  if (b) {
    const tag = b.status === 'stale' ? 'stalled' : b.status;
    const say = b.status === 'running' ? 'already running over ' : b.status === 'stale' ? 'a scan says running but went silent over ' : 'already queued over ';
    return { n: tag + ' ' + b.overlap + '/' + b.of, tag, say: say + b.overlap + ' of ' + b.of + ' features' };
  }
  if (!r.measured) return { n: String(r.of), say: r.of + ' features, none read yet' };
  const age = ago(now - r.oldestMs!).replace(' ago', '');
  return { n: 'read ' + r.measured + '/' + r.of + ' · ' + age, say: 'read ' + r.measured + ' of ' + r.of + ' features, the oldest ' + ago(now - r.oldestMs!) };
}
