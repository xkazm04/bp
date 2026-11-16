// POST /api/products/[slug]/proposals/[id]/veto with a VetoBody `{ reason }`: a person reverses a machine decision (decided_by
// `machine:*`, approved or declined, inside its `veto_until` window; scan-finding/1 L1). The store's compare-and-set
// (store.server.ts veto) puts the row back to `proposed` with decision_note `veto: <reason>`, signed `user:<gh login>`
// (triageBy, as decisions are); lens-scan's trust verb counts it as a reversal. 200 + the updated Proposal; 400 for a bad
// body; 404 for an unknown product, store or proposal; 409 with the current row when it is not (or no longer) vetoable
// (a person's decision, the window passed, the skill moved it on, or a v4 store). 403 while BP_WRITES=off.
// Admission (guards, product, JSON body and its shape, store): the route door (route-door.server.ts).
import { door } from '@bp/core/server/route-door.server';
import { storeFile } from '@bp/core/server/products.server';
import { MAX_VETO_REASON, parseVeto, veto } from '@bp/core/server/store.server';
import { triageBy } from '@bp/core/server/release.server';
import type { VetoBody } from '@bp/core/scan/types';

const vetoDoor = door('products/[slug]/proposals/[id]/veto', {
  POST: {
    body: (raw) => parseVeto(raw) ?? Response.json({ error: `body must be { reason: string } (1..${MAX_VETO_REASON} characters)` }, { status: 400 }),
    store: 'required',
    writes: true,
    live: async ({ product: p, params: { id }, body }) => {
      try {
        const r = veto(storeFile(p), id, body as VetoBody, await triageBy());
        if (r.ok) return Response.json(r.proposal);
        if (r.status === 404) return Response.json({ error: `no proposal ${id}` }, { status: 404 });
        return Response.json(r.proposal, { status: 409 });
      } catch (e) {
        // SQLITE_BUSY past the busy timeout lands here: the skill held the write lock too long.
        return Response.json({ error: `veto failed: ${(e as Error).message}` }, { status: 503 });
      }
    },
  },
});

export async function POST(req: Request, ctx: { params: Promise<{ slug: string; id: string }> }): Promise<Response> {
  return vetoDoor.POST(req, ctx);
}
