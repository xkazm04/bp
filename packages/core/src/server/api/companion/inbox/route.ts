// GET /api/companion/inbox?limit=50 (1..500): open decisions across every product of bp.products.local.json that has a
// lens-scan store, ranked (rank.ts: tier, then value per effort, then age), each with the recommendation a companion
// attached (POST /api/companion/recommendations). 200 `{ items: InboxItem[], skipped: { product, why }[] }`: a product
// that cannot be read is named in `skipped`, never dropped silently. 400 for a bad limit. Localhost only.
import { localHost } from '../../../../scan/local-only.ts';
import { inbox } from '../views.server.ts';

export function GET(req: Request): Response {
  const denied = localHost(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const raw = new URL(req.url).searchParams.get('limit'), limit = raw === null ? 50 : Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) return Response.json({ error: 'limit must be an integer 1..500' }, { status: 400 });
  return Response.json(inbox(limit));
}
