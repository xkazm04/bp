// GET /api/products: the live products of bp.products.local.json (Kettle is built in and not listed).
// `live` = the product repo has a lens-scan store.
import { hasStore, listProducts } from '@/lib/scan/products.server';
import type { ProductInfo } from '@/lib/scan/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(): Response {
  const out: ProductInfo[] = listProducts().map((p) => ({ slug: p.slug, name: p.name, live: hasStore(p) }));
  return Response.json(out);
}
