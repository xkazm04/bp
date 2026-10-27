// GET /api/companion/gaps?product=<slug>&limit=20 (1..200; `slug` is accepted for `product`, the scan.gaps tool's name):
// where coverage is lacking, over one registered product or all of them (views.server.ts): unmeasured and stale readings
// per feature and enabled lens, coverage rows unknown or deviating, scored base x tier weight (rank.ts) and ranked.
// 200 `{ gaps: Gap[], skipped: { product, why }[] }` (an unreadable product, or one without a map, is named, not dropped);
// 400 for a bad limit. Localhost only.
import { localHost } from '../../../../scan/local-only.ts';
import { gaps } from '../views.server.ts';

export function GET(req: Request): Response {
  const denied = localHost(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const q = new URL(req.url).searchParams, raw = q.get('limit'), limit = raw === null ? 20 : Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) return Response.json({ error: 'limit must be an integer 1..200' }, { status: 400 });
  return Response.json(gaps(q.get('product') ?? q.get('slug') ?? undefined, limit));
}
