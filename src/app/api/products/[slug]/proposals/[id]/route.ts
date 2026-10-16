// POST /api/products/[slug]/proposals/[id] with a DecisionBody: approve or decline a `proposed` row.
// 200 + the updated Proposal; 400 for a bad body; 404 for an unknown product, store or proposal; 409 with the
// current row (a Proposal, as the body) when it is no longer `proposed` (someone decided first, or the skill has moved it on).
// The decision is signed `user:<gh login>` (release.server.ts triageBy), as triage and release are. 403 while BP_WRITES=off.
import { findProduct, hasStore, storeFile } from '@/lib/scan/products.server';
import { localOnly, jsonOnly } from '@/lib/scan/local-only';
import { decide, parseDecision } from '@/lib/scan/store.server';
import { triageBy } from '@/lib/scan/release.server';
import { writesOff } from '@/lib/scan/writes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }): Promise<Response> {
  const denied = localOnly(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const readOnly = writesOff();
  if (readOnly) return Response.json({ error: readOnly }, { status: 403 });
  const notJson = jsonOnly(req);
  if (notJson) return Response.json({ error: notJson }, { status: 415 });
  const { slug, id } = await params;
  const p = findProduct(slug);
  if (!p) return Response.json({ error: `unknown product ${slug}` }, { status: 404 });
  let raw: unknown;
  try { raw = await req.json(); } catch { return Response.json({ error: 'body must be JSON' }, { status: 400 }); }
  const body = parseDecision(raw);
  if (!body) return Response.json({ error: "body must be { decision: 'approve' | 'decline', note?: string }" }, { status: 400 });
  if (!hasStore(p)) return Response.json({ error: `no scan store for ${slug}` }, { status: 404 });
  try {
    const r = decide(storeFile(p), id, body, await triageBy());
    if (r.ok) return Response.json(r.proposal);
    if (r.status === 404) return Response.json({ error: `no proposal ${id}` }, { status: 404 });
    return Response.json(r.proposal, { status: 409 });
  } catch (e) {
    // SQLITE_BUSY past the busy timeout lands here: the skill held the write lock too long.
    return Response.json({ error: `decision failed: ${(e as Error).message}` }, { status: 503 });
  }
}
