// POST /api/products/[slug]/proposals/[id] with a DecisionBody: approve or decline a `proposed` row.
// 200 + the updated Proposal; 400 for a bad body; 404 for an unknown product, store or proposal; 409 with the
// current row (a Proposal, as the body) when it is no longer `proposed` (someone decided first, or the skill has moved it on).
// The decision is signed `user:<gh login>` (triageBy, as triage and release are). 403 while BP_WRITES=off.
// Admission (guards, product, JSON body and its shape, store): the route door (route-door.server.ts).
import { door } from '@bp/core/server/route-door.server';
import { storeFile } from '@bp/core/server/products.server';
import { decide, parseDecision } from '@bp/core/server/store.server';
import { triageBy } from '@bp/core/server/release.server';
import { agentSigner } from '../../../../companion/door.server.ts';
import type { DecisionBody } from '@bp/core/scan/types';

const proposal = door('products/[slug]/proposals/[id]', {
  POST: {
    body: (raw) => parseDecision(raw) ?? Response.json({ error: "body must be { decision: 'approve' | 'decline', note?: string }" }, { status: 400 }),
    store: 'required',
    writes: true,
    live: async ({ req, slug, product: p, params: { id }, body }) => {
      // a call a standing permission runs is signed rule:G-n / policy:pol_.. (door.server.ts agentSigner), re-checked here
      const as = agentSigner(req, { slug, id, decision: (body as DecisionBody).decision });
      if (as && 'refuse' in as) return as.refuse;
      try {
        const r = decide(storeFile(p), id, body as DecisionBody, as?.by ?? await triageBy());
        if (r.ok) return Response.json(r.proposal);
        if (r.status === 404) return Response.json({ error: `no proposal ${id}` }, { status: 404 });
        return Response.json(r.proposal, { status: 409 });
      } catch (e) {
        // SQLITE_BUSY past the busy timeout lands here: the skill held the write lock too long.
        return Response.json({ error: `decision failed: ${(e as Error).message}` }, { status: 503 });
      }
    },
  },
});

export async function POST(req: Request, ctx: { params: Promise<{ slug: string; id: string }> }): Promise<Response> {
  return proposal.POST(req, ctx);
}
