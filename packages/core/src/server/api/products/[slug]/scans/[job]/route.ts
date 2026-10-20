// DELETE /api/products/[slug]/scans/[job]: cancel a scan job. A queued one leaves the queue; a running one is
// killed with its process tree. 200 + the ScanJob (a finished job is answered as it is); 404 for an unknown
// product or job. Localhost only.
import { unknownProduct } from '@bp/core/server/products.server';
import { findProduct } from '@bp/core/server/products.server';
import { localOnly } from '@bp/core/scan/local-only';
import { cancel } from '@bp/core/server/jobs.server';

export async function DELETE(req: Request, { params }: { params: Promise<{ slug: string; job: string }> }): Promise<Response> {
  const denied = localOnly(req);
  if (denied) return Response.json({ error: denied }, { status: 403 });
  const { slug, job } = await params;
  if (!findProduct(slug)) return unknownProduct(slug);
  const j = cancel(slug, job);
  return j ? Response.json(j) : Response.json({ error: `no job ${job}` }, { status: 404 });
}
