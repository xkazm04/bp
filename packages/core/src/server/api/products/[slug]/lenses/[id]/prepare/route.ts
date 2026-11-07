// POST /api/products/[slug]/lenses/[id]/prepare, body `{}`: queue a prepare job, which runs the Claude Code CLI headless in the
// product repo to make the lens measurable there (jobs.server.ts preparePrompt: probe scripts plus the overlay's `## Probes`).
// The scan menu offers it for a lens the overlay leaves unmeasurable (ProductInfo.setup, scan/lens-setup.ts), instead of a scan
// lens-scan would refuse. 202 + the ScanJob; 400 `{ error: 'unknown-lens' }` (not an enabled lens of the map) or
// `'not-preparable'` (no prepare job knows this lens: PREPARABLE); 409 while one for the lens is queued or running; 429 when the
// queue is full; 404 for an unknown product or one without a map, 409 for a map that does not parse (the door's map stage). Kettle's sim answers the same (its job ends done at once).
// Localhost only; admission is the route door's (route-door.server.ts).
import { door } from '@bp/core/server/route-door.server';
import { enqueuePrepare } from '@bp/core/server/jobs.server';
import { lensOn } from '@bp/core/server/map.server';
import { gateScan, refusedBy } from '@bp/core/server/rules.server';

const prepare = door('products/[slug]/lenses/[id]/prepare', {
  POST: {
    body: true,
    kettle: (k, { params }) => k.prepareLens(params.id),
    kettleStatus: 202,
    map: 'required',
    live: ({ slug, product: p, params, map }) => {
      const entry = map.lenses.find((e) => e.id === params.id && lensOn(e));
      if (!entry) return Response.json({ error: 'unknown-lens' }, { status: 400 });
      // a prepare job edits the product repo for one lens across the product: a standing order that refuses that lens's
      // scan of everything (a hold, an `only` of other lenses) refuses it too, cited (rules.server.ts)
      const g = gateScan(p, 'lens.prepare', entry.id, { kind: 'all', label: 'Everything', features: [] });
      if (g.refused) return refusedBy(g);
      const r = enqueuePrepare(slug, p.root, entry.id);
      return r.ok ? Response.json(r.job, { status: 202 }) : Response.json({ error: r.error }, { status: r.status });
    },
  },
});

export async function POST(req: Request, ctx: { params: Promise<{ slug: string; id: string }> }): Promise<Response> {
  return prepare.POST(req, ctx);
}
