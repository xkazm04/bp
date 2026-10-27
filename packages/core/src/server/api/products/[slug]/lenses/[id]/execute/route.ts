// POST /api/products/[slug]/lenses/[id]/execute, body `{}`: execute a lens's backlog. Its `proposed` findings are
// approved through the store's decision write (decided_by 'blueprint'), its `approved` ones are taken as they are,
// and execute jobs of at most 50 (MAX_PROPOSALS) are queued over them (`/lens-scan execute --proposals ...`), in the
// store's order (created_at, then id). Skipped, as `{ id, status }`: findings in any other status (`executing`,
// `done`, `failed`, `declined`), `in-job` for one a queued or running execute job already builds, `unsafe-id` for an
// id that may not reach a command line (waves.server.ts takeForBuild over scan/admit.ts, the rule every build entry reads).
// 202 `{ jobs, approved, skipped }`; 409 `{ error, skipped }` when nothing could
// go; 400 `{ error: 'unknown-lens' }` for a lens the map lacks or has disabled; 404 for an unknown product, a missing
// map or a missing store; 429 `{ error, jobs, approved, skipped }` when the queue cap stopped it (the approvals stand,
// `jobs` holds the ones queued before the cap); 503 when the store stayed locked; 403 while BP_WRITES=off. Localhost only.
import { unknownProduct } from '@bp/core/server/products.server';
import { findProduct, hasStore, storeFile } from '@bp/core/server/products.server';
import { localOnly, jsonOnly } from '@bp/core/scan/local-only';
import type { ScanJob } from '@bp/core/scan/jobs';
import { buildChunks } from '@bp/core/scan/admit';
import { busyProposals, enqueueExecute } from '@bp/core/server/jobs.server';
import { readLensesAndFeatures } from '@bp/core/server/lens-write.server';
import { snapshotOf } from '@bp/core/server/store.server';
import { writesOff } from '@bp/core/scan/writes';
import { triageBy } from '@bp/core/server/release.server';
import { takeForBuild } from '@bp/core/server/waves.server';

export async function POST(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }): Promise<Response> {
  const denied = localOnly(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const readOnly = writesOff();
  if (readOnly) return Response.json({ error: readOnly }, { status: 403 });
  const notJson = jsonOnly(req);
  if (notJson) return Response.json({ error: notJson }, { status: 415 });
  const { slug, id: lens } = await params;
  try { await req.json(); } catch { return Response.json({ error: 'body must be JSON' }, { status: 400 }); }
  const p = findProduct(slug);
  if (!p) return unknownProduct(slug);
  const map = readLensesAndFeatures(p);
  if (!map) return Response.json({ error: `no readable structure for ${slug}` }, { status: 404 });
  if (!map.lenses.some((e) => e.id === lens && e.enabled)) return Response.json({ error: 'unknown-lens' }, { status: 400 });
  if (!hasStore(p)) return Response.json({ error: `no scan store for ${slug}` }, { status: 404 });

  const file = storeFile(p);
  let ids: string[];
  try { ids = snapshotOf(file).proposals.filter((x) => x.lens === lens).map((x) => x.id); } catch (e) {
    return Response.json({ error: `execute failed: ${(e as Error).message}`, approved: [], skipped: [] }, { status: 503 });
  }
  const { approved, go, skipped, error } = takeForBuild(file, ids, busyProposals(slug), await triageBy());
  if (error) return Response.json({ error: `execute failed: ${error}`, approved, skipped }, { status: 503 });
  if (!go.length) return Response.json({ error: 'nothing to execute', skipped }, { status: 409 });

  const jobs: ScanJob[] = [], chunks = buildChunks(go);
  for (const chunk of chunks) {
    const r = enqueueExecute(slug, p.root, chunk);
    if (!r.ok) return Response.json({ error: `${r.error}; ${jobs.length} of ${chunks.length} execute jobs queued`, jobs, approved, skipped }, { status: r.status });
    jobs.push(r.job);
  }
  return Response.json({ jobs, approved, skipped }, { status: 202 });
}
