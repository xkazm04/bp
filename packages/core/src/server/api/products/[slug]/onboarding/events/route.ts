// GET /api/products/[slug]/onboarding/events[?job=<id>]: the build-up of an adopt job (default: the latest) as Server-Sent
// Events, `data: <BuildupEvent JSON>` per event (apps/web/src/buildup/contract.ts). Every event of the job from `begin` first
// (from its journal, `<root>/.ai/lens-scan/work/bp-jobs/<id>.buildup.jsonl`), then live ones; a comment ping every 15 s; the
// stream stays open after done/failed. 404 when the product has no such adopt job (or is unknown; Kettle 405); 400 for a
// job id that is no id; 429 past 16 open streams. Localhost only. Admission: the route door (route-door.server.ts).
import { door } from '@bp/core/server/route-door.server';
import { buildupStream } from '@bp/core/server/onboarding.server';
import { SAFE_ID } from '@bp/core/scan/jobs';

const events = door('products/[slug]/onboarding/events', {
  GET: {
    live: ({ req, slug, product: p }) => {
      const job = new URL(req.url).searchParams.get('job');
      if (job !== null && !SAFE_ID.test(job)) return Response.json({ error: 'bad job id' }, { status: 400 });
      return buildupStream(req, slug, p.root, job);
    },
  },
});

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }): Promise<Response> {
  return events.GET(req, ctx);
}
