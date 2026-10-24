// The build and finish routes' shared handler: start a release job (packages/core/src/server/jobs.server.ts enqueueRelease) for
// `rel-<version>`, after the route's localhost guards. 202 + the ScanJob; 400 for a bad release id; 404 for an unknown product, store or release; 409 when
// the release is in no state for that step (scan/release-steps.ts STEP_FROM: build from draft or failed, finish from pr-open or merged) or already has a job
// queued or running; 412 `{ error: 'gh not authenticated' }` when `gh auth status` fails; 429 when 16 jobs are queued.
import { unknownProduct } from '@bp/core/server/products.server';
import { findProduct, hasStore, storeFile } from '@bp/core/server/products.server';
import type { ReleaseStep } from '@bp/core/scan/jobs';
import { enqueueRelease, releaseBusy } from '@bp/core/server/jobs.server';
import { RELEASE_ID } from '@bp/core/scan/release';
import { canStart, startRefusal } from '@bp/core/scan/release-steps';
import { ghAuthed } from '@bp/core/server/release.server';
import { snapshotOf } from '@bp/core/server/store.server';
import type { Release } from '@bp/core/scan/types';

export async function startRelease(req: Request, params: Promise<{ slug: string; id: string }>, step: ReleaseStep): Promise<Response> {
  void req; // the route guarded it (localOnly, jsonOnly); a release job takes no body
  const { slug, id } = await params;
  const p = findProduct(slug);
  if (!p) return unknownProduct(slug);
  if (!RELEASE_ID.test(id)) return Response.json({ error: 'bad-release' }, { status: 400 });
  if (!hasStore(p)) return Response.json({ error: `no scan store for ${slug}` }, { status: 404 });
  let rel: Release | undefined;
  try { rel = snapshotOf(storeFile(p)).releases.find((r) => r.id === id); } catch (e) { return Response.json({ error: `cannot read the scan store: ${(e as Error).message}` }, { status: 503 }); }
  if (!rel) return Response.json({ error: `no release ${id}` }, { status: 404 });
  if (!canStart(step, rel.status)) return Response.json({ error: startRefusal(id, rel.status, step), release: rel }, { status: 409 });
  if (releaseBusy(slug, id)) return Response.json({ error: `a release job for ${id} is already queued or running` }, { status: 409 });
  if (!(await ghAuthed())) return Response.json({ error: 'gh not authenticated' }, { status: 412 });
  const r = enqueueRelease(slug, p.root, id, rel.version, step);
  return r.ok ? Response.json(r.job, { status: 202 }) : Response.json({ error: r.error }, { status: r.status });
}
