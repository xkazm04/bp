// The build and finish routes' shared handler: start a release job (packages/core/src/server/jobs.server.ts enqueueRelease) for
// `rel-<version>`, after the route's localhost guards. 202 + the ScanJob; 400 for a bad release id; 404 for an unknown product, store or release; 409 when
// the release is in no state for that step (scan/release-steps.ts STEP_FROM: build from draft or failed, finish from pr-open or merged) or already has a job
// queued or running; 412 `{ error: 'gh not authenticated' }` when `gh auth status` fails; 429 when 16 jobs are queued.
// A dry build (`{"dry":true}`, the Release tab's pre-flight) runs the same guards from local state only - the store row,
// the job registry, the queue - and answers 200 `{ ready: true, gh: 'unchecked' }` with nothing queued: it never spawns gh
// (or anything else), so the login is still checked when the real build starts.
import { unknownProduct } from '@bp/core/server/products.server';
import { findProduct, hasStore, storeFile } from '@bp/core/server/products.server';
import type { ReleaseStep } from '@bp/core/scan/jobs';
import { enqueueRelease, list, MAX_QUEUED, releaseBusy } from '@bp/core/server/jobs.server';
import { RELEASE_ID } from '@bp/core/scan/release';
import { canStart, startRefusal } from '@bp/core/scan/release-steps';
import { ghAuthed } from '@bp/core/server/release.server';
import { snapshotOf } from '@bp/core/server/store.server';
import type { ProductEntry, Release } from '@bp/core/scan/types';
import type { ReleaseReady } from '@bp/core/model/scan-sim';

/** 400 for a path id that is not `rel-<version>`, else null (the build route's door params check). */
export const badReleaseId = (id: string): Response | null => (RELEASE_ID.test(id) ? null : Response.json({ error: 'bad-release' }, { status: 400 }));

export async function startRelease(req: Request, params: Promise<{ slug: string; id: string }>, step: ReleaseStep): Promise<Response> {
  void req; // the route guarded it (localOnly, jsonOnly); a release job takes no body
  const { slug, id } = await params;
  const p = findProduct(slug);
  if (!p) return unknownProduct(slug);
  const bad = badReleaseId(id);
  if (bad) return bad;
  if (!hasStore(p)) return Response.json({ error: `no scan store for ${slug}` }, { status: 404 });
  let rel: Release | undefined;
  try { rel = snapshotOf(storeFile(p)).releases.find((r) => r.id === id); } catch (e) { return Response.json({ error: `cannot read the scan store: ${(e as Error).message}` }, { status: 503 }); }
  return releaseAnswer(slug, p, id, rel, step, false);
}

/** The guards from the release row on (404, 409 state, 409 busy, then 412 gh), and the job; `dry` stops before gh with
 *  the queue's own 429 checked instead, and answers `{ ready: true, gh: 'unchecked' }` without queuing anything. */
export async function releaseAnswer(slug: string, p: ProductEntry, id: string, rel: Release | undefined, step: ReleaseStep, dry: boolean): Promise<Response> {
  if (!rel) return Response.json({ error: `no release ${id}` }, { status: 404 });
  if (!canStart(step, rel.status)) return Response.json({ error: startRefusal(id, rel.status, step), release: rel }, { status: 409 });
  if (releaseBusy(slug, id)) return Response.json({ error: `a release job for ${id} is already queued or running` }, { status: 409 });
  if (dry) {
    if (list(slug).filter((j) => j.status === 'queued').length >= MAX_QUEUED) return Response.json({ error: `${MAX_QUEUED} jobs are already queued for ${slug}` }, { status: 429 });
    const ready: ReleaseReady = { ready: true, gh: 'unchecked' };
    return Response.json(ready);
  }
  if (!(await ghAuthed())) return Response.json({ error: 'gh not authenticated' }, { status: 412 });
  const r = enqueueRelease(slug, p.root, id, rel.version, step);
  return r.ok ? Response.json(r.job, { status: 202 }) : Response.json({ error: r.error }, { status: r.status });
}
