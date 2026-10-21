// Scans as the plan draws them, shared by live products and the Kettle sim: the scopes a right-click offers at a
// place (`scopesAt`) and a job's progress read from the store rows (`jobProgress`). Pure.
import type { Layout } from '../model/layout.ts';
import type { Product } from '../model/product.ts';
import type { ScanSnapshot } from './types.ts';
import { isJobNote, type ScanJob, type ScanScope, type ScanScopeKind } from './jobs.ts';
import { measuredFeatures } from './derive.ts';

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
