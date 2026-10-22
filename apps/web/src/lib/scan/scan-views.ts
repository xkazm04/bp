// Scans as the plan draws them, shared by live products and the Kettle sim: the scopes a right-click offers
// at a place (`scopesAt`), a job's progress read from the store rows (`jobProgress`), and the views the
// engine's scan layer draws (`scanViews`). Pure, discrete-time only (never per frame); type-only imports
// from the model and relative value imports, so Node runs it as-is (the scan-package probes).
import type { Layout, Product } from '@bp/core/model';
import type { ScanView } from '@/engine/render/scans';
import type { ScanSnapshot } from '@bp/core/scan/types';
import { isJobNote, type ScanJob, type ScanScope } from '@bp/core/scan/jobs';

import { scopesAt, jobProgress, type JobProgress, type ScopeOption } from '@bp/core/scan/views';
export { scopesAt, jobProgress, type JobProgress, type ScopeOption } from '@bp/core/scan/views';
type Geo = { P: Product; L: Layout };

/** How long a finished job keeps its outline: done (all ticks), failed (in the bad colour). Cancelled ones vanish. */
export const LINGER_MS: Partial<Record<ScanJob['status'], number>> = { done: 3000, failed: 6000 };

/**
 * How long a running job may go without a sign of life before the plan stops drawing it as live. A sign of
 * life is the newest activity row of the job's own run (a reading or a measured feature lands every few
 * seconds on a healthy scan), else the job's start. Generous on purpose: a slow feature is not a dead one.
 */
export const STALE_MS = 10 * 60 * 1000;

/** The newest sign of life of a running job, in ms: its run's last activity row, else its start; NaN if neither parses. */
function lastSeen(j: ScanJob, scan: ScanSnapshot | undefined): number {
  let last = Date.parse(j.started_at ?? j.queued_at);
  const run = scan && (scan.runs.find((r) => r.id === j.run_id) ?? scan.runs.find((r) => isJobNote(r.note, j.id)));
  if (run && scan) for (const a of scan.activity) if (a.run_id === run.id) { const t = Date.parse(a.at); if (t > last || !Number.isFinite(last)) last = t; }
  return last;
}

/**
 * The views of the measure jobs worth drawing at `now`: queued and running ones (a running one with no sign of life for STALE_MS as `stale`), and finished ones while they
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
      // A finished job keeps its outline for `linger` after it ended. One that has no usable `ended_at` has
      // nothing to count from: jobs.server.ts writes it at the finish, so a process that died mid-run (or a
      // row from an older store) reaches the stream `done` or `failed` with no end at all, and the outline
      // that should report the failure was skipped entirely. Count from when it started instead - stable
      // across recomputes, unlike `now`, which would restart the window on every pass and never expire.
      const ended = Date.parse(j.ended_at ?? '');
      const end = (Number.isFinite(ended) ? ended : Date.parse(j.started_at ?? j.queued_at)) + linger;
      if (!(end > now)) continue;
      next = Math.min(next, end);
    }
    // A running job with no sign of life for STALE_MS is drawn `stale` (it is not known to have failed); until
    // then the view expires at that cutoff, so the caller recomputes and the outline stops marching on time.
    let status: ScanView['status'] = j.status;
    if (j.status === 'running') {
      const seen = lastSeen(j, scan);
      if (Number.isFinite(seen)) { if (seen + STALE_MS <= now) status = 'stale'; else next = Math.min(next, seen + STALE_MS); }
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
        current: status === 'running' && pr.current ? pr.current + sf : undefined,
        n: j.status === 'done' ? pr.m : pr.n, m: pr.m, status,
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
