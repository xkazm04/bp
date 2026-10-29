// POST /api/companion/recommendations, body `{ slug, id, verdict: 'approve' | 'decline' | 'rework' | 'descope', why }`: a
// recommended verdict on one open decision, for the person to approve in a batch (the decision.recommend tool, AUTO: it
// decides nothing). Stored in companionHome()/recommendations.json, last writer wins per `slug:id`; the inbox shows it.
// The recommendation carries the proposal's decision brief (scan/brief.ts: its advice and lines), so it comes with its own
// context; when it recommends approving what the brief says repeats a standing decline, the answer says so (`conflict`),
// and it is still stored: the person decides. 201 `{ slug, id, verdict, why, at, brief?, conflict? }`; 400 for a bad
// body; 404 for an unknown product. Localhost only.
import { jsonOnly, localOnly } from '../../../../scan/local-only.ts';
import { SAFE_ID } from '../../../../scan/jobs.ts';
import { findProduct } from '../../../products.server.ts';
import type { Verdict } from '../../../../companion/contract.ts';
import { recommend } from '../door.server.ts';
import { briefSource, trail } from '../../../brief.server.ts';
import { briefFor, subjectOf } from '../../../../scan/brief.ts';

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
  const src = briefSource(b.slug), p = src instanceof Response ? undefined : src.scan.proposals.find((x) => x.id === b.id);
  const brief = p && !(src instanceof Response) ? briefFor(subjectOf(p), src.scan, src.map) : null;
  const r = recommend(b.slug, b.id, { verdict: b.verdict as Verdict, why: b.why.trim(), ...(brief ? { brief: { say: brief.advice.say, lines: brief.lines } } : {}) });
  trail(req, { kind: 'recommend', product: b.slug, id: b.id, verdict: r.verdict, why: r.why });
  const conflict = brief?.advice.say === 'withdraw' && b.verdict === 'approve' ? { conflict: `the brief says this repeats a standing decline: ${brief.advice.why}` } : {};
  return Response.json({ slug: b.slug, id: b.id, ...r, ...conflict }, { status: 201 });
}
