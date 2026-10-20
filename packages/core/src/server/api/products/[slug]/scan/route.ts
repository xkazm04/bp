// GET /api/products/[slug]/scan: the whole ScanSnapshot (activity = the latest 200 rows, ascending id).
// A product without a store answers the empty scan, so every feature reads unmeasured.
import { findProduct, storeFile } from '@bp/core/server/products.server';
import { localHost } from '@bp/core/scan/local-only';
import { snapshotOf } from '@bp/core/server/store.server';

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const denied = localHost(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const { slug } = await params;
  const p = findProduct(slug);
  if (!p) return Response.json({ error: `unknown product ${slug}` }, { status: 404 });
  try { return Response.json(snapshotOf(storeFile(p))); } catch (e) {
    return Response.json({ error: `store read failed: ${(e as Error).message}` }, { status: 500 });
  }
}
