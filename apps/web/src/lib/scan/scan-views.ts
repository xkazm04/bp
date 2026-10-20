// Scans as the plan draws them, shared by live products and the Kettle sim: the scopes a right-click offers
// at a place (`scopesAt`), a job's progress read from the store rows (`jobProgress`), and the views the
// engine's scan layer draws (`scanViews`). Pure, discrete-time only (never per frame); type-only imports
// from the model and relative value imports, so Node runs it as-is (the scan-package probes).
import type { Layout, Product } from '@bp/core/model';
import type { Crumb } from '@/engine/state';
import type { ScanView } from '@/engine/render/scans';
import type { ScanSnapshot } from '@bp/core/scan/types';
import { isJobNote, type ScanJob, type ScanScope, type ScanScopeKind } from '@bp/core/scan/jobs';
import { measuredFeatures } from '@bp/core/scan/derive';

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
export function scopesAt(M: Geo, chain: readonly Crumb[], tile: string | null): ScopeOption[] {
  const { L } = M, out: ScopeOption[] = [];
  const T = tile ? L.TILE[tile] : undefined;
  if (T) out.push({ kind: 'feature', title: 'Feature', scope: { kind: 'feature', id: T.f.slug, label: T.f.name, features: [T.f.slug] } });
  const at = (t: Crumb['t']) => chain.find((c) => c.t === t)?.id;
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
  /** The feature of the run's latest reading or measured row. */
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
    current = a.feature;
  }
  return { done, current, n: Math.min(done.size, m), m };
}

/** How long a finished job keeps its outline: done (all ticks), failed (in the bad colour). Cancelled ones vanish. */
export const LINGER_MS: Partial<Record<ScanJob['status'], number>> = { done: 3000, failed: 6000 };

/**
 * The views of the measure jobs worth drawing at `now`: queued and running ones, and finished ones while they
 * linger. At `?scale` > 1 a job gets one view per product line (the readings land in every line). `next` is
 * when the next lingering view expires (Infinity when none): the caller recomputes then.
 */
export function scanViews(jobs: readonly ScanJob[], scan: ScanSnapshot | undefined, M: Geo, accent: (lens: string) => string, now: number): { views: ScanView[]; next: number } {
  const { P, L } = M, views: ScanView[] = [], baseAll = P.base.features.map((f) => f.id);
  let next = Infinity;
  const order = jobs.filter((j) => j.kind === 'measure' && j.lens && j.scope)
    .sort((a, b) => ((a.started_at ?? a.queued_at) < (b.started_at ?? b.queued_at) ? -1 : (a.started_at ?? a.queued_at) > (b.started_at ?? b.queued_at) ? 1 : 0));
  for (const j of order) {
    const linger = LINGER_MS[j.status];
    if (j.status === 'cancelled') continue;
    if (linger !== undefined) {
      const end = Date.parse(j.ended_at ?? '') + linger;
      if (!(end > now)) continue;
      next = Math.min(next, end);
    }
    const sc = j.scope!, all = sc.kind === 'all', pr = jobProgress(j, scan, baseAll.length);
    const full = j.status === 'done' ? new Set(all ? baseAll : sc.features) : pr.done;
    for (let b = 0; b < P.scale; b++) {
      const sf = P.buildings[b]?.sf ?? '', B = L.blds[b];
      const place = placeOf(M, sc, b, sf);
      views.push({
        id: P.scale > 1 ? j.id + '@' + b : j.id, lens: j.lens!, accent: accent(j.lens!), place,
        features: all ? [] : sc.features.map((f) => f + sf).filter((id) => L.TILE[id]),
        done: new Set([...full].map((f) => f + sf).filter((id) => L.TILE[id]?.wing.bld === B)),
        current: j.status === 'running' && pr.current ? pr.current + sf : undefined,
        n: j.status === 'done' ? pr.m : pr.n, m: pr.m, status: j.status,
      });
    }
  }
  return { views, next };
}

/** The layout node a scope names in product line `b`; null = outline the features' bounding box (or the whole site). */
function placeOf(M: Geo, sc: ScanScope, b: number, sf: string): ScanView['place'] {
  const { P, L } = M, inLine = (bi: number) => bi === b;
  switch (sc.kind) {
    case 'feature': { const T = sc.id ? L.TILE[sc.id + sf] : undefined; return T ? { t: 'tile', id: T.id } : null; }
    case 'bay': { const x = L.bays.find((n) => n.cap.base === sc.id && inLine(n.room.wing.bld.i)); return x ? { t: 'bay', id: x.id } : null; }
    case 'room': { const x = L.rooms.find((n) => n.d.base === sc.id && inLine(n.wing.bld.i)); return x ? { t: 'room', id: x.id } : null; }
    case 'wing': { const x = L.wings.find((n) => n.def.k === sc.id && inLine(n.bld.i)); return x ? { t: 'wing', id: x.id } : null; }
    default: return P.scale > 1 && L.blds[b] ? { t: 'bld', id: L.blds[b].id } : null;
  }
}
