// GET /api/products/[slug]/scan: the whole ScanSnapshot (activity = the latest 200 rows, ascending id).
// A product without a store answers the empty scan, so every feature reads unmeasured. Kettle, where this process hosts its
// sim (kettle-sim.server.ts), answers the sim's snapshot.
import { unknownProduct } from '@bp/core/server/products.server';
import { findProduct, storeFile } from '@bp/core/server/products.server';
import { localHost } from '@bp/core/scan/local-only';
import { snapshotOf } from '@bp/core/server/store.server';
import { kettleSim, simAnswer } from '@bp/core/server/kettle-sim.server';

export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }): Promise<Response> {
  const denied = localHost(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const { slug } = await params;
  const k = kettleSim(slug);
  if (k) return simAnswer(() => k.snapshot());
  const p = findProduct(slug);
  if (!p) return unknownProduct(slug);
  try { return Response.json(snapshotOf(storeFile(p))); } catch (e) {
    return Response.json({ error: `store read failed: ${(e as Error).message}` }, { status: 500 });
  }
}
