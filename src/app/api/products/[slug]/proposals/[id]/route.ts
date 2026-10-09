// POST /api/products/[slug]/proposals/[id] with a DecisionBody: approve or decline a `proposed` row.
// 200 + the updated Proposal; 400 for a bad body; 404 for an unknown product, store or proposal; 409 with the
// current row (a Proposal, as the body) when it is no longer `proposed` (someone decided first, or the skill has moved it on).
import { findProduct, hasStore, storeFile } from '@/lib/scan/products.server';
import { decide, parseDecision } from '@/lib/scan/store.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }): Promise<Response> {
  const { slug, id } = await params;
  const p = findProduct(slug);
  if (!p) return Response.json({ error: `unknown product ${slug}` }, { status: 404 });
  let raw: unknown;
  try { raw = await req.json(); } catch { return Response.json({ error: 'body must be JSON' }, { status: 400 }); }
  const body = parseDecision(raw);
  if (!body) return Response.json({ error: "body must be { decision: 'approve' | 'decline', note?: string }" }, { status: 400 });
  if (!hasStore(p)) return Response.json({ error: `no scan store for ${slug}` }, { status: 404 });
  try {
    const r = decide(storeFile(p), id, body);
    if (r.ok) return Response.json(r.proposal);
    if (r.status === 404) return Response.json({ error: `no proposal ${id}` }, { status: 404 });
    return Response.json(r.proposal, { status: 409 });
  } catch (e) {
    // SQLITE_BUSY past the busy timeout lands here: the skill held the write lock too long.
    return Response.json({ error: `decision failed: ${(e as Error).message}` }, { status: 503 });
  }
}
