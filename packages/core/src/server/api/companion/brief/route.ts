// GET /api/companion/brief?product=<slug>&feature=<feature slug>&title=<words>&lens=<id>  (or &id=<proposal id>): the
// plan.brief tool (catalog.ts, AUTO). Before an agent proposes, it reads what the person already decided about the idea:
// the same pure brief the decision card shows (packages/core/src/scan/brief.ts), over a draft instead of a stored row -
// the feature's place and stage, the declines that match the idea quoted in the person's words (latest first, one per
// standard), how similar decisions went, what undoing costs, and `advice` (withdraw when a matching decline stands).
// `id` briefs a stored proposal instead. `slug` is accepted for `product`. The answer is the Brief, bounded by its own
// budget (lines x width; precedent rows capped at BRIEF_ROWS for the wire). 400 for a bad query; 404 for an unknown
// product, store or proposal; Kettle answers from apps/server's hosted sim. Localhost only. An agent's read (it names its
// conversation in x-bp-conversation, as the MCP door does) is kept on the agent trail for the cards slip.
import { localHost } from '../../../../scan/local-only.ts';
import { briefFor, subjectOf, type Brief, type BriefSubject } from '../../../../scan/brief.ts';
import { briefSource, trail } from '../../../brief.server.ts';

/** The precedent rows an agent gets on the wire (the counts stay whole). */
export const BRIEF_ROWS = 8;
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function GET(req: Request): Response {
  const denied = localHost(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const q = new URL(req.url).searchParams, product = q.get('product') ?? q.get('slug') ?? '';
  const id = q.get('id'), feature = q.get('feature') ?? '', title = (q.get('title') ?? '').trim(), lens = q.get('lens') ?? undefined;
  if (!SLUG.test(product)) return Response.json({ error: 'product must be a product slug' }, { status: 400 });
  if (!id && !feature) return Response.json({ error: 'name the feature (plan.find gives its slug) and the idea in title, or a proposal id' }, { status: 400 });
  if (title.length > 300) return Response.json({ error: 'title is at most 300 characters' }, { status: 400 });
  const src = briefSource(product);
  if (src instanceof Response) return src;
  let sub: BriefSubject;
  if (id) {
    const p = src.scan.proposals.find((x) => x.id === id);
    if (!p) return Response.json({ error: `no proposal ${id}` }, { status: 404 });
    sub = subjectOf(p);
  } else sub = { feature, title: title || feature, ...(lens ? { lens } : {}) };
  const b: Brief = briefFor(sub, src.scan, src.map);
  trail(req, { kind: 'brief', product, feature: sub.feature, title: sub.title, advice: b.advice.say, ...(b.declines[0] ? { declineId: b.declines[0].id, ...(b.declines[0].note ? { quoted: b.declines[0].note } : {}) } : {}) });
  return Response.json({ ...b, precedent: { ...b.precedent, rows: b.precedent.rows.slice(0, BRIEF_ROWS) } });
}
