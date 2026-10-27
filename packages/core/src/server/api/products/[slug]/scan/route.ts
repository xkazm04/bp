// GET /api/products/[slug]/scan: the whole ScanSnapshot (activity = the latest 200 rows, ascending id).
// A product without a store answers the empty scan, so every feature reads unmeasured; 503 when the store cannot be read.
// Kettle, where this process hosts its sim (kettle-sim.server.ts), answers the sim's snapshot. Admission: the route door.
import { door } from '@bp/core/server/route-door.server';
import { snapshotOf } from '@bp/core/server/store.server';

const scan = door('products/[slug]/scan', {
  GET: { kettle: (k) => k.snapshot(), live: (c) => Response.json(c.read(snapshotOf)) },
});

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }): Promise<Response> {
  return scan.GET(req, ctx);
}
