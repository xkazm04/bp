// The outcome watch (owner-enabled, at or after Finish or Tag): a release's items followed on the base branch through
// fixed checkpoints, so a promise is checked when it shipped and again later. Pure: the server keeps the watches in a
// work sidecar (server/watch.server.ts, `<root>/.ai/lens-scan/work/bp-watch.json`) and the Kettle sim in memory; both
// build, schedule and judge them here, and the ledger's History renders what watchState says.
//   enable    freezes, per item, the target (baseline + expected_delta as trackOf read it then), the direction, and the
//             landing receipt (git's landing commit, else the release's merge or tag time); an item with no number to
//             judge by, or a target outside the metric's bounds, is kept as unresolved, with why
//   schedule  checkpoints WATCH_DAYS after enabling; a due one queues one selection scan per lens over the items'
//             features (jobs.ts measureScopes), its jobs labelled `Watch v<version> · day <n>` so a restart finds the
//             jobs it already queued (checkpointPlan adopts them) and never queues them twice; a checkpoint whose window
//             passed unmeasured is missed, never queued late
//   judge     checkpoint n is judged by the reading trackOf would judge the item by (its eligibility: method, unit,
//             commit containing the landing), taken in the checkpoint's window [due n, due n+1), against the FIXED
//             target: met or short. The item reads pending (nothing judged yet), target met, shortfall, or regression
//             (met at a checkpoint, short at a later one). Missing readings never count as success.
import { measureScopes, type ScanJob } from '../scan/jobs.ts';
import { boundWords, meetsTarget, trackOf, type TrackOpts } from '../scan/track.ts';
import type { Proposal, Release, ScanSnapshot } from '../scan/types.ts';

/** Days after enabling at which a checkpoint falls due. */
export const WATCH_DAYS: readonly number[] = [1, 7, 30];
const DAY = 86400000;

export interface WatchItem {
  id: string;
  title: string;
  feature: string;
  lens: string;
  metric?: string;
  unit?: string;
  baseline?: number;
  /** The fixed target, frozen at enabling. */
  target?: number;
  /** 'up': the target is met at or above it; 'down': at or below. */
  better?: 'up' | 'down';
  /** The landing receipt: git's landing commit and time, else the release's merge or tag time. */
  landing?: { sha?: string; at: string };
  /** Why it cannot be judged (no metric, no expected value, target out of bounds); absent when it can. */
  unresolved?: string;
}
export interface Checkpoint {
  day: number;
  due: string;
  /** The measure jobs queued for it (one per lens). */
  jobs?: string[];
  /** Its window passed before it was queued: never measured late. */
  missed?: true;
}
export interface Watch {
  release: string;
  version: string;
  enabled_at: string;
  by: string;
  items: WatchItem[];
  checkpoints: Checkpoint[];
  /** When the owner turned it off (it keeps its record; turning it on again resumes it). */
  off_at?: string;
}

type Scan = Pick<ScanSnapshot, 'proposals' | 'measurements' | 'packs' | 'releases'>;
export type WatchRefusal = { ok: false; status: 400 | 404 | 409; error: string };

/** A new watch over release `relId`'s items, or why not: an unknown release (404), one not merged or tagged yet (409). */
export function newWatch(scan: Scan, relId: string, opts: TrackOpts, nowIso: string, by: string): { ok: true; watch: Watch } | WatchRefusal {
  const rel = scan.releases.find((r) => r.id === relId);
  if (!rel) return { ok: false, status: 404, error: `no release ${relId}` };
  if (rel.status !== 'merged' && rel.status !== 'tagged') return { ok: false, status: 409, error: `release ${relId} is ${rel.status}: a watch starts at or after Finish or Tag` };
  const items = scan.proposals.filter((p) => p.release_id === relId).map((p) => itemOf(scan, p, rel, opts));
  if (!items.length) return { ok: false, status: 409, error: `release ${relId} carries no item to watch` };
  const at = Date.parse(nowIso);
  return { ok: true, watch: { release: rel.id, version: rel.version, enabled_at: nowIso, by, items, checkpoints: WATCH_DAYS.map((day) => ({ day, due: new Date(at + day * DAY).toISOString() })) } };
}

function itemOf(scan: Scan, p: Proposal, rel: Release, opts: TrackOpts): WatchItem {
  const t = trackOf(scan, p.id, opts);
  const it: WatchItem = { id: p.id, title: p.title, feature: p.feature, lens: p.lens };
  if (p.metric) it.metric = p.metric;
  if (t?.unit) it.unit = t.unit;
  if (t?.baseline !== undefined) it.baseline = t.baseline;
  it.landing = t?.landed ? { sha: t.landed.sha, at: t.landed.at } : { at: rel.updated_at };
  if (!p.metric) it.unresolved = 'no metric: there is no number to judge it by';
  else if (t?.expected === undefined || !p.expected_delta) it.unresolved = 'no expected value to judge it by';
  else if (t.outOfBounds) it.unresolved = `target out of bounds: expected ${fmt(t.expected)}${t.unit ? ' ' + t.unit : ''}, ${boundWords(t.outOfBounds)}`;
  else { it.target = t.expected; it.better = p.expected_delta > 0 ? 'up' : 'down'; }
  return it;
}

/** Turn a watch on (a new one, or an off one again, keeping its record) or off. */
export function setWatchIn(watches: readonly Watch[], w: Watch | null, relId: string, on: boolean, nowIso: string): { ok: true; watches: Watch[]; watch: Watch } | WatchRefusal {
  const old = watches.find((x) => x.release === relId);
  if (!on) {
    if (!old) return { ok: false, status: 404, error: `no watch on ${relId}` };
    const off = { ...old, off_at: old.off_at ?? nowIso };
    return { ok: true, watches: watches.map((x) => (x === old ? off : x)), watch: off };
  }
  if (old) { const back: Watch = { ...old }; delete back.off_at; return { ok: true, watches: watches.map((x) => (x === old ? back : x)), watch: back }; }
  if (!w) return { ok: false, status: 404, error: `no release ${relId}` };
  return { ok: true, watches: [...watches, w], watch: w };
}

/** The scan label of checkpoint `day`'s jobs: how a restart recognises the jobs it already queued. */
export const checkpointLabel = (w: Pick<Watch, 'version'>, day: number): string => `Watch v${w.version} · day ${day}`;

/** What reconciling a watch does now: per due checkpoint, adopt the jobs already in the registry under its label, queue
 *  the lenses that have none, or mark it missed when its window passed. Checkpoints with jobs recorded are left alone. */
export interface CheckpointPlan { day: number; adopt: string[]; queue: { lens: string; features: string[]; label: string }[]; missed?: true }
export function checkpointPlan(w: Watch, nowMs: number, jobs: readonly Pick<ScanJob, 'id' | 'kind' | 'lens' | 'scope'>[]): CheckpointPlan[] {
  if (w.off_at) return [];
  const out: CheckpointPlan[] = [];
  const scopes = measureScopes(w.items.filter((x) => !x.unresolved));
  w.checkpoints.forEach((c, i) => {
    if (c.jobs?.length || c.missed || Date.parse(c.due) > nowMs) return;
    const next = w.checkpoints[i + 1];
    const label = checkpointLabel(w, c.day), mine = jobs.filter((j) => j.kind === 'measure' && j.scope?.label === label);
    if (next && Date.parse(next.due) <= nowMs && !mine.length) { out.push({ day: c.day, adopt: [], queue: [], missed: true }); return; }
    out.push({ day: c.day, adopt: mine.map((j) => j.id), queue: scopes.filter((s) => !mine.some((j) => j.lens === s.lens)).map((s) => ({ ...s, label })) });
  });
  return out.filter((p) => p.missed || p.adopt.length || p.queue.length);
}
/** The watch with a plan's outcome recorded: each checkpoint's jobs (adopted and queued), or missed. */
export function recordPlan(w: Watch, plans: readonly CheckpointPlan[], queued: ReadonlyMap<number, string[]>): Watch {
  return { ...w, checkpoints: w.checkpoints.map((c) => {
    const p = plans.find((x) => x.day === c.day);
    if (!p) return c;
    if (p.missed) return { ...c, missed: true };
    const jobs = [...p.adopt, ...(queued.get(c.day) ?? [])];
    return jobs.length ? { ...c, jobs } : c;
  }) };
}

export type WatchItemState = 'pending' | 'met' | 'shortfall' | 'regression' | 'unresolved';
export interface CheckpointResult { day: number; due: string; value?: number; at?: string; met?: boolean; how: 'judged' | 'not yet due' | 'measuring' | 'not measured' | 'missed' }
export interface WatchItemView { id: string; title: string; state: WatchItemState; words: string; checkpoints: CheckpointResult[] }
export interface WatchView { release: string; on: boolean; items: WatchItemView[]; counts: Record<WatchItemState, number>; next?: string }

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
/** Where each watched item stands at `nowMs`: its checkpoints judged against the fixed target (see the header). */
export function watchState(w: Watch, scan: Scan, opts: TrackOpts, nowMs: number, jobs: readonly Pick<ScanJob, 'id' | 'status'>[] = []): WatchView {
  const counts: Record<WatchItemState, number> = { pending: 0, met: 0, shortfall: 0, regression: 0, unresolved: 0 };
  const cuts = w.checkpoints.map((c, i) => {
    const end = w.checkpoints[i + 1]?.due;
    return end ? { ...scan, measurements: scan.measurements.filter((m) => m.measured_at < end) } : scan;
  });
  const items = w.items.map((it): WatchItemView => {
    const u = it.unit ? ' ' + it.unit : '';
    if (it.unresolved || it.target === undefined || !it.better) { counts.unresolved++; return { id: it.id, title: it.title, state: 'unresolved', words: 'unresolved: ' + (it.unresolved ?? 'no target'), checkpoints: [] }; }
    const results = w.checkpoints.map((c, i): CheckpointResult => {
      const base = { day: c.day, due: c.due };
      if (Date.parse(c.due) > nowMs) return { ...base, how: 'not yet due' };
      if (c.missed) return { ...base, how: 'missed' };
      const t = trackOf(cuts[i], it.id, opts);
      if (t?.evidence && t.current !== undefined && t.currentAt && t.currentAt >= c.due) return { ...base, how: 'judged', value: t.current, at: t.currentAt, met: meetsTarget(t.current, it.target!, it.better === 'up' ? 1 : -1) };
      const busy = (c.jobs ?? []).some((id) => { const j = jobs.find((x) => x.id === id); return !!j && (j.status === 'queued' || j.status === 'running'); });
      return { ...base, how: busy ? 'measuring' : 'not measured' };
    });
    const judged = results.filter((r) => r.how === 'judged'), last = judged[judged.length - 1];
    const state: WatchItemState = !last ? 'pending' : last.met ? 'met' : judged.some((r) => r.met) ? 'regression' : 'shortfall';
    counts[state]++;
    const tgt = `target ${fmt(it.target)}${u}`;
    const words = !last ? `pending: ${tgt}, no checkpoint judged yet`
      : state === 'met' ? `target met: ${fmt(last.value!)}${u} on day ${last.day} (${tgt})`
        : state === 'regression' ? `regression: met on day ${judged.find((r) => r.met)!.day}, ${fmt(last.value!)}${u} on day ${last.day} (${tgt})`
          : `shortfall: ${fmt(last.value!)}${u} on day ${last.day} (${tgt})`;
    return { id: it.id, title: it.title, state, words, checkpoints: results };
  });
  const next = w.off_at ? undefined : w.checkpoints.find((c) => Date.parse(c.due) > nowMs)?.due;
  return { release: w.release, on: !w.off_at, items, counts, ...(next ? { next } : {}) };
}

/** A watch file's watches: anything that is not one is dropped (a hand edit, an older shape). */
export function watchesOf(x: unknown): Watch[] | null {
  const xs = (x as { watches?: unknown } | null)?.watches;
  if (!Array.isArray(xs)) return null;
  return xs.filter((w): w is Watch => !!w && typeof w.release === 'string' && typeof w.version === 'string' && typeof w.enabled_at === 'string' && Array.isArray(w.items) && Array.isArray(w.checkpoints));
}
