// GET /api/products/[slug]/proposals/[id]/brief: the decision brief of one proposal (packages/core/src/scan/brief.ts):
// blast radius, precedent, reversibility and cost, each with the ids that back it, plus `lines` (the brief in plain words,
// BRIEF_LINES x BRIEF_WIDTH) and `advice`. Open or decided, any row has one. 200 `Brief`; 404 for an unknown product, store
// or proposal; Kettle answers from apps/server's hosted sim (405 where none is hosted). Read-only. Localhost only.
// An agent's read (x-bp-conversation) is kept on the agent trail (brief.server.ts) for the cards slip.
import { localHost } from '@bp/core/scan/local-only';
import { briefFor, subjectOf } from '@bp/core/scan/brief';
import { briefRow, briefSource, trail } from '@bp/core/server/brief.server';

export async function GET(req: Request, { params }: { params: Promise<{ slug: string; id: string }> }): Promise<Response> {
  const denied = localHost(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const { slug, id } = await params;
  const src = briefSource(slug);
  if (src instanceof Response) return src;
  const p = src.scan.proposals.find((x) => x.id === id);
  if (!p) return Response.json({ error: `no proposal ${id}` }, { status: 404 });
  const b = briefFor(subjectOf(p), src.scan, src.map);
  trail(req, briefRow(slug, b));
  return Response.json(b);
}
