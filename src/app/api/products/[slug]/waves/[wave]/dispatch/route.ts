// POST /api/products/[slug]/waves/[wave]/dispatch, body `{ packages?: string[] }` (default: every package): build a wave's
// findings, one execute job per package (and per 50 findings) run with the package's own `--model` and `--effort`. Per package
// the `proposed` findings are approved (decided_by 'blueprint') and the `approved` ones taken, unless a queued or running
// execute job already builds them (skipped as `in-job`); the first job makes the wave `dispatched`, later calls append
// ("Dispatch remaining"). 202 `{ wave, jobs, approved, skipped }`; 409 `{ error, skipped }` when none could go; 400 for a bad
// body or package; 404 for an unknown product, wave or missing store; 429 `{ error, wave, jobs, approved, skipped }` when the
// queue cap stopped it (the jobs queued so far are recorded in the wave, the approvals stand); 503 when the store stayed locked.
// Localhost only.
import { findProduct, hasStore } from '@/lib/scan/products.server';
import { localOnly, jsonOnly } from '@/lib/scan/local-only';
import { SAFE_ID } from '@/lib/scan/jobs';
import { dispatchWave } from '@/lib/scan/waves.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ slug: string; wave: string }> }): Promise<Response> {
  const denied = localOnly(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const notJson = jsonOnly(req);
  if (notJson) return Response.json({ error: notJson }, { status: 415 });
  const { slug, wave } = await params;
  const p = findProduct(slug);
  if (!p) return Response.json({ error: `unknown product ${slug}` }, { status: 404 });
  if (!SAFE_ID.test(wave)) return Response.json({ error: 'bad wave id' }, { status: 400 });
  let body: unknown;
  try { body = await req.json(); } catch { return Response.json({ error: 'body must be JSON' }, { status: 400 }); }
  const names = (body as { packages?: unknown } | null)?.packages;
  if (names !== undefined && (!Array.isArray(names) || !names.length || names.some((n) => typeof n !== 'string' || !SAFE_ID.test(n)))) {
    return Response.json({ error: 'packages must be a list of package ids' }, { status: 400 });
  }
  if (!hasStore(p)) return Response.json({ error: `no scan store for ${slug}` }, { status: 404 });
  try {
    const r = dispatchWave(slug, p, wave, names as string[] | undefined);
    return Response.json(r.body, { status: r.status });
  } catch (e) { return Response.json({ error: `dispatch failed: ${(e as Error).message}` }, { status: 503 }); }
}
