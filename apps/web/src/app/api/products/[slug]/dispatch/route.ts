// POST /api/products/[slug]/dispatch, body `{ ids: string[] }` (1..50 proposal ids): build findings. Each
// `proposed` one is approved through the store's decision write (decided_by 'blueprint'), an `approved` one is
// taken as it is, anything else is skipped with its status ('unknown' for an id the store lacks). Then ONE
// execute job runs over all that were approved or taken (`/lens-scan execute --proposals ...`). The
// approve-and-take step is waves.server.ts takeForBuild, shared with the wave dispatch. 202
// `{ job, approved, skipped }` (`approved` = the ids this call approved; `job.proposals` = every id it builds);
// 409 `{ error, skipped }` when none could go; 400 for a bad body; 404 for an unknown product or a missing store;
// 429 when 16 jobs are queued (the approvals stand); 503 when the store stayed locked. Localhost only.
import { findProduct, hasStore, storeFile } from '@bp/core/server/products.server';
import { localOnly, jsonOnly } from '@bp/core/scan/local-only';
import { SAFE_ID } from '@bp/core/scan/jobs';
import { MAX_PROPOSALS, enqueueExecute } from '@bp/core/server/jobs.server';
import { takeForBuild } from '@bp/core/server/waves.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const denied = localOnly(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const notJson = jsonOnly(req);
  if (notJson) return Response.json({ error: notJson }, { status: 415 });
  const { slug } = await params;
  const p = findProduct(slug);
  if (!p) return Response.json({ error: `unknown product ${slug}` }, { status: 404 });
  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ error: 'body must be JSON' }, { status: 400 }); }
  const ids = (body as { ids?: unknown } | null)?.ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > MAX_PROPOSALS || ids.some((i) => typeof i !== 'string' || !SAFE_ID.test(i))) {
    return Response.json({ error: `body must be { ids: string[] } with 1..${MAX_PROPOSALS} proposal ids` }, { status: 400 });
  }
  if (!hasStore(p)) return Response.json({ error: `no scan store for ${slug}` }, { status: 404 });
  const file = storeFile(p);
  const { approved, go, skipped, error } = takeForBuild(file, ids as string[]);
  if (error) return Response.json({ error: `dispatch failed: ${error}`, approved, skipped }, { status: 503 });
  if (!go.length) return Response.json({ error: 'none of these proposals can be built (only proposed or approved ones can)', skipped }, { status: 409 });
  const r = enqueueExecute(slug, p.root, go);
  return r.ok ? Response.json({ job: r.job, approved, skipped }, { status: 202 }) : Response.json({ error: r.error, approved, skipped }, { status: r.status });
}
