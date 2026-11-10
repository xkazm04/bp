// GET /api/products/[slug]/onboarding/feed?after=<n>[&job=<id>][&layout=islands]: the build-up of an adopt job (default:
// the latest) as pollable JSON, for a client that cannot read Server-Sent Events (UE's HTTP: the VR table polls it):
// `{ job, events, next, done }`. `events` = the job's journal entries (BuildupEvent, apps/web/src/buildup/contract.ts) with
// index >= `after` (default 0, from `begin`), at most 500; `next` = the `after` of the next poll; `done` = the job has ended
// and every event, its `done`/`failed` last, has been answered. `layout=islands` re-projects every `structure` event's
// nodes as `/plan?layout=islands` lays out the product's map now (onboarding.server.ts structureIslands), so the drawn
// build-up lands where the live table stands at done; without it the boxes are as journaled. A product with no adopt job answers
// `{ job: null, events: [], next: 0, done: true }`. 404 for an unknown product (Kettle 405) or an unknown `job`; 400 for
// a job id that is no id or an `after` that is not a whole number. Localhost only. Admission: the route door.
import { door } from '@bp/core/server/route-door.server';
import { buildupPage } from '@bp/core/server/onboarding.server';
import { SAFE_ID } from '@bp/core/scan/jobs';
import { jobFor } from '@bp/core/server/device-view.server';

const feed = door('products/[slug]/onboarding/feed', {
  GET: {
    live: ({ req, slug, product: p }) => {
      const q = new URL(req.url).searchParams;
      const job = q.get('job'), afterRaw = q.get('after') ?? '0';
      if (job !== null && !SAFE_ID.test(job)) return Response.json({ error: 'bad job id' }, { status: 400 });
      if (!/^\d{1,9}$/.test(afterRaw)) return Response.json({ error: 'after must be a whole number' }, { status: 400 });
      const page = buildupPage(p, { after: Number(afterRaw), jobId: job, islands: q.get('layout') === 'islands' });
      return page ? Response.json({ ...page, job: jobFor(req, page.job) }) : Response.json({ error: `no onboarding job ${job} for ${slug}` }, { status: 404 });
    },
  },
});

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }): Promise<Response> {
  return feed.GET(req, ctx);
}
