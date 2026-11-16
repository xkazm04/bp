// GET /api/products/[slug]/onboarding: `{ job: ScanJob | null }`, the product's latest adopt job (live, or read back from
// the job journal after a restart). Its `adopt_phase` is the build-up phase it last started (the failed phase for a failed
// job). 404 for an unknown product (Kettle 405). Localhost only. Admission: the route door (route-door.server.ts).
import { door } from '@bp/core/server/route-door.server';
import { latestAdopt } from '@bp/core/server/onboarding.server';

const onboarding = door('products/[slug]/onboarding', {
  GET: { live: ({ slug }) => Response.json({ job: latestAdopt(slug) }) },
});

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }): Promise<Response> {
  return onboarding.GET(req, ctx);
}
