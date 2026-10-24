// DELETE /api/products/[slug]/scans/[job]: cancel a scan job. A queued one leaves the queue; a running one is
// killed with its process tree. 200 + the ScanJob (a finished job is answered as it is); 404 for an unknown
// product or job. Localhost only. Kettle, where this process hosts its sim (kettle-sim.server.ts): the sim cancels it.
// Admission: the route door (route-door.server.ts).
import { door } from '@bp/core/server/route-door.server';
import { cancel } from '@bp/core/server/jobs.server';

const scanJob = door('products/[slug]/scans/[job]', {
  DELETE: {
    kettle: (k, { params }) => k.cancel(params.job),
    live: ({ slug, params: { job } }) => {
      const j = cancel(slug, job);
      return j ? Response.json(j) : Response.json({ error: `no job ${job}` }, { status: 404 });
    },
  },
});

export async function DELETE(req: Request, ctx: { params: Promise<{ slug: string; job: string }> }): Promise<Response> {
  return scanJob.DELETE(req, ctx);
}
