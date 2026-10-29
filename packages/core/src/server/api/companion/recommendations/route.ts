// POST /api/companion/recommendations, body `{ slug, id, verdict: 'approve' | 'decline' | 'rework' | 'descope', why }`: a
// recommended verdict on one open decision, for the person to approve in a batch (the decision.recommend tool, AUTO: it
// decides nothing). Stored in companionHome()/recommendations.json, last writer wins per `slug:id`; the inbox shows it.
// 201 `{ slug, id, verdict, why, at }`; 400 for a bad body; 404 for an unknown product. Localhost only.
import { jsonOnly, localOnly } from '../../../../scan/local-only.ts';
import { SAFE_ID } from '../../../../scan/jobs.ts';
import { findProduct } from '../../../products.server.ts';
import type { Verdict } from '../../../../companion/contract.ts';
import { recommend } from '../door.server.ts';
import { trail } from '../../../brief.server.ts';

const VERDICTS: Verdict[] = ['approve', 'decline', 'rework', 'descope'];

export async function POST(req: Request): Promise<Response> {
  const denied = localOnly(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const notJson = jsonOnly(req);
  if (notJson) return Response.json({ error: notJson }, { status: 415 });
  let b: Record<string, unknown>;
  try { b = (await req.json()) as Record<string, unknown>; } catch { return Response.json({ error: 'body must be JSON' }, { status: 400 }); }
  if (!b || typeof b !== 'object' || typeof b.slug !== 'string' || typeof b.id !== 'string' || !SAFE_ID.test(b.id)
    || !VERDICTS.includes(b.verdict as Verdict) || typeof b.why !== 'string' || !b.why.trim() || b.why.length > 2000) {
    return Response.json({ error: "body must be { slug, id, verdict: 'approve' | 'decline' | 'rework' | 'descope', why (1..2000) }" }, { status: 400 });
  }
  if (!findProduct(b.slug)) return Response.json({ error: `unknown product ${b.slug}` }, { status: 404 });
  const r = recommend(b.slug, b.id, { verdict: b.verdict as Verdict, why: b.why.trim() });
  trail(req, { kind: 'recommend', product: b.slug, id: b.id, verdict: r.verdict, why: r.why });
  return Response.json({ slug: b.slug, id: b.id, ...r }, { status: 201 });
}
